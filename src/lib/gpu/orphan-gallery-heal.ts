/**
 * After Railway redeploy / process restart, in-memory GPU workers die but
 * GalleryItem meta can stay `pending` / `busy` forever. Heal those rows:
 * error status + peach refund + Telegram notify (once).
 */
import { prisma } from "@/lib/db";

const USER_MSG = "Связь с GPU оборвалась — нажми Повторить";

function parseMeta(raw: string | null | undefined): Record<string, unknown> {
  try {
    return JSON.parse(raw || "{}") as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function refundChargedPeaches(opts: {
  userId: string;
  charged: number;
  galleryItemId: string;
  meta: Record<string, unknown>;
  reason: string;
  gpuJobId?: string;
}): Promise<boolean> {
  const { userId, charged, galleryItemId, meta, reason, gpuJobId } = opts;
  if (charged <= 0) return false;
  if (Number(meta.refundedPeaches || 0) > 0) return false;

  const funnel =
    meta.funnelV2 === true ||
    meta.source === "funnel_v2" ||
    String(meta.engine || "").includes("funnel_v2");

  try {
    if (funnel) {
      const { creditFunnelBalance } = await import("@/lib/tg/funnel-v2/mode");
      await creditFunnelBalance(userId, charged);
    } else {
      const { creditPeaches } = await import("@/lib/tg/wallet");
      await creditPeaches(userId, charged, reason, {
        galleryItemId,
        ...(gpuJobId ? { gpuJobId } : {}),
      });
    }
    return true;
  } catch (e) {
    console.error(
      "[peach] orphan-gallery refund failed:",
      e instanceof Error ? e.message : e,
    );
    return false;
  }
}

/** Mark one pending/busy gallery item as error, refund, notify TG once. */
export async function failAbandonedGalleryItem(opts: {
  itemId: string;
  reason: string;
  userMessage?: string;
  gpuJobId?: string;
}): Promise<boolean> {
  const item = await prisma.galleryItem.findUnique({
    where: { id: opts.itemId },
  });
  if (!item?.userId) return false;

  const meta = parseMeta(item.metaJson);
  if (meta.status !== "pending" && meta.status !== "busy") return false;
  if (meta.orphanHealedAt) return false;

  const userMessage = opts.userMessage || USER_MSG;
  const charged = Number(meta.chargedPeaches || 0) || 0;
  const nowIso = new Date().toISOString();

  let next: Record<string, unknown> = {
    ...meta,
    status: "error",
    error: userMessage,
    orphanHealedAt: nowIso,
    orphanReason: opts.reason,
  };

  await prisma.galleryItem.update({
    where: { id: item.id },
    data: { metaJson: JSON.stringify(next) },
  });

  const refunded = await refundChargedPeaches({
    userId: item.userId,
    charged,
    galleryItemId: item.id,
    meta: next,
    reason: "orphan_restart_refund",
    gpuJobId: opts.gpuJobId,
  });
  if (refunded) {
    next = { ...next, refundedPeaches: charged };
    await prisma.galleryItem.update({
      where: { id: item.id },
      data: { metaJson: JSON.stringify(next) },
    });
  }

  if (!next.userNotifiedErrorAt) {
    try {
      const { notifyTelegramGenerationError } = await import(
        "@/lib/tg/tg-notify"
      );
      // Message must trip ourFault regex (GPU / Comfy / tunnel) → friendly notice.
      await notifyTelegramGenerationError(
        item.userId,
        `GPU orphaned after process restart: ${opts.reason}`,
      );
      next = {
        ...next,
        userNotifiedErrorAt: new Date().toISOString(),
      };
      await prisma.galleryItem.update({
        where: { id: item.id },
        data: { metaJson: JSON.stringify(next) },
      });
    } catch (e) {
      console.error(
        "[peach] orphan-gallery notify failed:",
        e instanceof Error ? e.message : e,
      );
    }
  }

  return true;
}

export type OrphanRecoverResult = {
  jobsHealed: number;
  galleryHealed: number;
};

/**
 * 1) Mark stale active GpuJobs as error and heal linked gallery / quick-video.
 * 2) Sweep abandoned pending/busy gallery with no live GpuJob (already-orphaned).
 */
export async function recoverOrphanedGpuWork(opts?: {
  minAgeMs?: number;
}): Promise<OrphanRecoverResult> {
  const minAgeMs = opts?.minAgeMs ?? 12 * 60_000;
  const cutoff = new Date(Date.now() - minAgeMs);
  let jobsHealed = 0;
  let galleryHealed = 0;

  const orphans = await prisma.gpuJob.findMany({
    where: {
      status: { in: ["queued", "assigned", "running"] },
      updatedAt: { lt: cutoff },
    },
    take: 80,
  });

  for (const job of orphans) {
    const reason =
      "orphaned after process restart — check recover / retry";

    // Safe recover first: if Comfy already finished, deliver instead of fail.
    if (job.refType === "quickVideoRun" && job.refId) {
      try {
        const { tryRecoverQuickVideoRunById } = await import(
          "@/lib/quick-video"
        );
        const recovered = await tryRecoverQuickVideoRunById(
          job.refId,
          job.userId,
        );
        if (recovered) {
          await prisma.gpuJob.update({
            where: { id: job.id },
            data: {
              status: "done",
              stage: "done",
              error: null,
              finishedAt: new Date(),
              runMs: job.startedAt
                ? Math.max(0, Date.now() - job.startedAt.getTime())
                : null,
            },
          });
          if (job.workerId) {
            await prisma.gpuWorker
              .update({
                where: { id: job.workerId },
                data: { currentJobId: null, status: "online" },
              })
              .catch(() => undefined);
          }
          galleryHealed += 1;
          jobsHealed += 1;
          continue;
        }
      } catch (e) {
        console.error(
          "[peach] orphan quick-video recover:",
          e instanceof Error ? e.message : e,
        );
      }
    }

    await prisma.gpuJob.update({
      where: { id: job.id },
      data: {
        status: "error",
        stage: "error",
        error: reason,
        finishedAt: new Date(),
        runMs: job.startedAt
          ? Math.max(0, Date.now() - job.startedAt.getTime())
          : null,
      },
    });
    if (job.workerId) {
      await prisma.gpuWorker
        .update({
          where: { id: job.workerId },
          data: { currentJobId: null, status: "online" },
        })
        .catch(() => undefined);
    }

    if (job.refType === "galleryItem" && job.refId) {
      const ok = await failAbandonedGalleryItem({
        itemId: job.refId,
        reason,
        gpuJobId: job.id,
      });
      if (ok) galleryHealed += 1;
    } else if (job.refType === "quickVideoRun" && job.refId) {
      try {
        let userId = job.userId;
        if (!userId) {
          const run = await prisma.quickVideoRun.findUnique({
            where: { id: job.refId },
            select: { userId: true },
          });
          userId = run?.userId ?? null;
        }
        if (userId) {
          const { failQuickVideoRun } = await import("@/lib/quick-video");
          await failQuickVideoRun(job.refId, userId, reason);
          galleryHealed += 1;
        }
      } catch (e) {
        console.error(
          "[peach] orphan quick-video fail:",
          e instanceof Error ? e.message : e,
        );
      }
    }
    jobsHealed += 1;
  }

  // Already-orphaned: pending/busy gallery older than cutoff, no live GpuJob.
  const candidates = await prisma.galleryItem.findMany({
    where: {
      createdAt: { lt: cutoff },
      OR: [
        { metaJson: { contains: '"status":"pending"' } },
        { metaJson: { contains: '"status":"busy"' } },
      ],
    },
    orderBy: { createdAt: "asc" },
    take: 120,
  });

  for (const item of candidates) {
    const meta = parseMeta(item.metaJson);
    if (meta.status !== "pending" && meta.status !== "busy") continue;
    if (meta.orphanHealedAt) continue;

    const qvId =
      typeof meta.quickVideoRunId === "string" ? meta.quickVideoRunId : null;

    const activeJob = await prisma.gpuJob.findFirst({
      where: {
        status: { in: ["queued", "assigned", "running"] },
        OR: [
          { refType: "galleryItem", refId: item.id },
          ...(qvId
            ? [{ refType: "quickVideoRun" as const, refId: qvId }]
            : []),
        ],
      },
      select: { id: true },
    });
    if (activeJob) continue;

    if (qvId && item.userId) {
      const run = await prisma.quickVideoRun.findUnique({
        where: { id: qvId },
        select: { id: true, status: true, userId: true },
      });
      if (run && (run.status === "busy" || run.status === "queued")) {
        try {
          const { tryRecoverQuickVideoRunById, failQuickVideoRun } =
            await import("@/lib/quick-video");
          const recovered = await tryRecoverQuickVideoRunById(
            run.id,
            run.userId,
          );
          if (recovered) {
            galleryHealed += 1;
            continue;
          }
          await failQuickVideoRun(
            run.id,
            run.userId,
            "orphaned after process restart — pending gallery, no live GpuJob",
          );
          galleryHealed += 1;
        } catch (e) {
          console.error(
            "[peach] orphan busy quick-video fail:",
            e instanceof Error ? e.message : e,
          );
        }
        continue;
      }
    }

    const ok = await failAbandonedGalleryItem({
      itemId: item.id,
      reason:
        "orphaned pending gallery — no live GpuJob after process restart",
    });
    if (ok) galleryHealed += 1;
  }

  return { jobsHealed, galleryHealed };
}
