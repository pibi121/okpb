/**
 * Close a GpuJob whose user-facing result is already saved.
 * The healer used to treat that as "still running" and refund a finished video.
 */
import { prisma } from "@/lib/db";
import { GALLERY_PLACEHOLDER_URL } from "@/lib/gallery-meta";

/** Tunnel/Comfy down: wait this long, then recover/requeue once it is back. */
export const TUNNEL_HOLD_PHOTO_MS = 45 * 60_000;
export const TUNNEL_HOLD_VIDEO_MS = 60 * 60_000;

export function isVideoGpuJob(job: { pool?: string | null; kind?: string | null }) {
  return (
    job.pool === "video" ||
    /video|clip|film|i2v|quick|animate/i.test(`${job.kind || ""} ${job.pool || ""}`)
  );
}

export function tunnelHoldMs(job: { pool?: string | null; kind?: string | null }) {
  return isVideoGpuJob(job) ? TUNNEL_HOLD_VIDEO_MS : TUNNEL_HOLD_PHOTO_MS;
}

type JobRow = {
  id: string;
  workerId?: string | null;
  startedAt?: Date | null;
  refType?: string | null;
  refId?: string | null;
};

export async function resultAlreadyDelivered(job: JobRow): Promise<boolean> {
  if (job.refType === "quickVideoRun" && job.refId) {
    const run = await prisma.quickVideoRun.findUnique({
      where: { id: job.refId },
      select: { status: true, resultVideoUrl: true },
    });
    return run?.status === "ready" && !!run.resultVideoUrl?.trim();
  }
  if (job.refType === "galleryItem" && job.refId) {
    const item = await prisma.galleryItem.findUnique({
      where: { id: job.refId },
      select: { resultUrl: true, metaJson: true },
    });
    if (!item) return false;
    let meta: Record<string, unknown> = {};
    try {
      meta = JSON.parse(item.metaJson || "{}") as Record<string, unknown>;
    } catch {
      meta = {};
    }
    const url = (item.resultUrl || "").trim();
    return (
      meta.status === "ready" &&
      !!url &&
      url !== GALLERY_PLACEHOLDER_URL
    );
  }
  return false;
}

/** Mark the ledger row done when the user already has the file. No refund. */
export async function closeGpuJobIfDelivered(
  job: JobRow,
  now = Date.now(),
): Promise<boolean> {
  if (!(await resultAlreadyDelivered(job))) return false;
  await prisma.gpuJob.update({
    where: { id: job.id },
    data: {
      status: "done",
      stage: "done",
      error: null,
      finishedAt: new Date(),
      runMs: job.startedAt
        ? Math.max(0, now - job.startedAt.getTime())
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
  console.log(
    `[peach] closed delivered gpu job ${job.id} (${job.refType || "?"})`,
  );
  return true;
}
