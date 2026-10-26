/**
 * Pose constructor queue.
 *
 * One order is one batch: every clip, then the stitch, on a single card.
 * The pose card never takes photos, probes, films, edits, or animate.
 * If the pose card is already booked for 30+ minutes, this batch may run on
 * one idle main Metalnode. At most one such overflow at a time. If no main
 * card is empty, the batch stays on the pose queue.
 *
 * Clip length is an estimate (4 min), not a measured average.
 */
import { prisma } from "@/lib/db";
import { pingWorkerComfy } from "@/lib/gpu/workers";

const ACTIVE = ["queued", "assigned", "running"] as const;

/** Estimated wall time for one 5-second constructor clip, until we have measurements. */
export const POSE_CLIP_ESTIMATE_MS = 4 * 60 * 1000;

/** Overflow only when work already ahead of this order is at least this long. */
export const POSE_OVERFLOW_AFTER_MS = 30 * 60 * 1000;

function safeJson(raw: string | null | undefined): Record<string, unknown> {
  try {
    return JSON.parse(raw || "{}") as Record<string, unknown>;
  } catch {
    return {};
  }
}

function clipsOf(meta: Record<string, unknown>): number {
  const n = Math.round(Number(meta.poseCount) || 1);
  return Math.max(1, n);
}

/** Work already lined up on the pose card, before this job. Overflow batches do not count. */
export async function poseBacklogMs(jobId: string, queuedAt: Date): Promise<number> {
  const rows = await prisma.gpuJob.findMany({
    where: {
      id: { not: jobId },
      pool: "pose",
      status: { in: [...ACTIVE] },
      queuedAt: { lte: queuedAt },
    },
    select: { status: true, startedAt: true, metaJson: true },
  });
  let ms = 0;
  const now = Date.now();
  for (const row of rows) {
    const meta = safeJson(row.metaJson);
    if (meta.poseOverflow === true || meta.posePlacement === "overflow") continue;
    const full = clipsOf(meta) * POSE_CLIP_ESTIMATE_MS;
    if ((row.status === "running" || row.status === "assigned") && row.startedAt) {
      ms += Math.max(0, full - (now - row.startedAt.getTime()));
    } else {
      ms += full;
    }
  }
  return ms;
}

async function markPlacement(
  jobId: string,
  prev: Record<string, unknown>,
  placement: "pose" | "overflow",
) {
  await prisma.gpuJob.update({
    where: { id: jobId },
    data: {
      metaJson: JSON.stringify({
        ...prev,
        posePlacement: placement,
        poseOverflow: placement === "overflow",
      }),
    },
  });
}

async function mainFleetBusy(): Promise<boolean> {
  const main = await prisma.gpuJob.count({
    where: {
      status: { in: [...ACTIVE] },
      pool: { notIn: ["pose", "lab"] },
    },
  });
  if (main > 0) return true;
  const overflow = await prisma.gpuJob.count({
    where: {
      pool: "pose",
      status: { in: [...ACTIVE] },
      metaJson: { contains: '"poseOverflow":true' },
    },
  });
  return overflow > 0;
}

/**
 * Claim one idle main Metalnode for this pose batch, or return null to stay
 * on the pose card. Decided once per job.
 */
export async function claimIdleMainForPose(jobId: string) {
  const job = await prisma.gpuJob.findUnique({ where: { id: jobId } });
  if (!job) return null;
  const meta = safeJson(job.metaJson);
  if (meta.posePlacement === "pose" || meta.posePlacement === "overflow") return null;

  const backlog = await poseBacklogMs(jobId, job.queuedAt);
  if (backlog < POSE_OVERFLOW_AFTER_MS) {
    await markPlacement(jobId, meta, "pose");
    return null;
  }
  if (await mainFleetBusy()) {
    await markPlacement(jobId, meta, "pose");
    return null;
  }

  const free = await prisma.gpuWorker.findMany({
    where: {
      enabled: true,
      provider: "metalnode",
      currentJobId: null,
      status: { in: ["online", "unknown"] },
      pool: { notIn: ["pose", "lab"] },
      NOT: { comfyUrl: "" },
    },
    orderBy: { updatedAt: "asc" },
  });

  for (const worker of free) {
    const ping = await pingWorkerComfy(worker.comfyUrl);
    if (!ping.ok || (ping.running || 0) > 0 || (ping.pending || 0) > 0) continue;
    if (await mainFleetBusy()) break;
    const claimed = await prisma.gpuWorker.updateMany({
      where: {
        id: worker.id,
        currentJobId: null,
        status: { in: ["online", "unknown"] },
      },
      data: { status: "busy", currentJobId: jobId },
    });
    if (claimed.count !== 1) continue;
    try {
      await markPlacement(jobId, meta, "overflow");
    } catch (err) {
      await prisma.gpuWorker
        .update({
          where: { id: worker.id },
          data: { currentJobId: null, status: "online" },
        })
        .catch(() => undefined);
      throw err;
    }
    return { ...worker, status: "busy", currentJobId: jobId };
  }

  await markPlacement(jobId, meta, "pose");
  return null;
}

/** True while a constructor overflow batch still owns this job row. */
export async function isLivePoseOverflow(jobId: string): Promise<boolean> {
  const job = await prisma.gpuJob.findUnique({
    where: { id: jobId },
    select: { status: true, metaJson: true },
  });
  if (!job || !ACTIVE.includes(job.status as (typeof ACTIVE)[number])) return false;
  return safeJson(job.metaJson).poseOverflow === true;
}
