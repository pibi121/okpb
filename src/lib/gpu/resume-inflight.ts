/**
 * After a deploy the in-memory waiter dies, but Comfy on the GPU keeps the prompt.
 * Poll history and deliver the finished file. Do not start a second render.
 * Lab-pool jobs are left alone.
 */
import { prisma } from "@/lib/db";

const PHOTO_BUDGET_MS = 15 * 60_000;
const VIDEO_BUDGET_MS = 45 * 60_000;
const POLL_MS = 15_000;

let started = false;

function parseMeta(raw: string | null | undefined): Record<string, unknown> {
  try {
    return JSON.parse(raw || "{}") as Record<string, unknown>;
  } catch {
    return {};
  }
}

function isVideoJob(kind: string, pool: string): boolean {
  return (
    pool === "video" ||
    /video|clip|film|i2v|quick|animate/i.test(`${kind} ${pool}`)
  );
}

async function beat(jobId: string): Promise<boolean> {
  const job = await prisma.gpuJob.findUnique({
    where: { id: jobId },
    select: { status: true, metaJson: true },
  });
  if (!job || !["queued", "assigned", "running"].includes(job.status)) {
    return false;
  }
  const meta = parseMeta(job.metaJson);
  meta.lastBeatAt = new Date().toISOString();
  await prisma.gpuJob.update({
    where: { id: jobId },
    data: { metaJson: JSON.stringify(meta) },
  });
  return true;
}

async function closeDelivered(jobId: string, workerId: string | null) {
  const job = await prisma.gpuJob.findUnique({
    where: { id: jobId },
    select: { status: true, startedAt: true },
  });
  if (!job || !["queued", "assigned", "running"].includes(job.status)) return;
  const now = Date.now();
  await prisma.gpuJob.update({
    where: { id: jobId },
    data: {
      status: "done",
      stage: "done",
      error: null,
      finishedAt: new Date(),
      runMs: job.startedAt ? Math.max(0, now - job.startedAt.getTime()) : null,
    },
  });
  if (workerId) {
    await prisma.gpuWorker
      .update({
        where: { id: workerId },
        data: { currentJobId: null, status: "online" },
      })
      .catch(() => undefined);
  }
}

async function pullFinished(job: {
  id: string;
  refType: string;
  refId: string;
  userId: string | null;
  workerId: string | null;
}): Promise<boolean> {
  if (job.refType === "quickVideoRun" && job.refId) {
    const { tryRecoverQuickVideoRunById } = await import("@/lib/quick-video");
    const ok = await tryRecoverQuickVideoRunById(job.refId, job.userId);
    if (ok) {
      await closeDelivered(job.id, job.workerId);
      return true;
    }
    return false;
  }
  if (job.refType === "galleryItem" && job.refId) {
    const { tryRecoverGalleryItemFromComfy } = await import(
      "@/lib/gpu/gallery-photo-heal"
    );
    const ok = await tryRecoverGalleryItemFromComfy(job.refId);
    if (ok) {
      await closeDelivered(job.id, job.workerId);
      return true;
    }
  }
  return false;
}

function watchOne(job: {
  id: string;
  kind: string;
  pool: string;
  refType: string;
  refId: string;
  userId: string | null;
  workerId: string | null;
  startedAt: Date | null;
  queuedAt: Date;
}) {
  const budget = isVideoJob(job.kind, job.pool) ? VIDEO_BUDGET_MS : PHOTO_BUDGET_MS;
  const deadline = (job.startedAt || job.queuedAt).getTime() + budget;
  void (async () => {
    while (Date.now() < deadline) {
      try {
        const alive = await beat(job.id);
        if (!alive) return;
        if (await pullFinished(job)) {
          console.log(`[peach] resume delivered ${job.refType} ${job.refId}`);
          return;
        }
      } catch (e) {
        console.warn(
          `[peach] resume poll ${job.id}:`,
          e instanceof Error ? e.message.slice(0, 160) : e,
        );
      }
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
    console.warn(
      `[peach] resume stopped ${job.id} — still running, healer will decide`,
    );
  })();
}

/** Reattach user generations whose Comfy prompt survived the process restart. */
export async function resumeInflightUserGenerations(): Promise<number> {
  if (started) return 0;
  started = true;
  const since = new Date(Date.now() - 6 * 60 * 60 * 1000);
  const jobs = await prisma.gpuJob.findMany({
    where: {
      status: { in: ["queued", "assigned", "running"] },
      queuedAt: { gte: since },
      pool: { not: "lab" },
      refType: { in: ["galleryItem", "quickVideoRun"] },
    },
    take: 30,
    orderBy: { queuedAt: "asc" },
  });
  let n = 0;
  for (const job of jobs) {
    const meta = parseMeta(job.metaJson);
    if (meta.ownerLab === true) continue;
    const promptId = typeof meta.comfyPromptId === "string" ? meta.comfyPromptId : "";
    if (!promptId) continue;
    n += 1;
    watchOne(job);
  }
  if (n > 0) {
    console.log(`[peach] resume: watching ${n} in-flight user generation(s)`);
  }
  return n;
}
