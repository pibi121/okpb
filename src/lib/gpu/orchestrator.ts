import { AsyncLocalStorage } from "async_hooks";
import { prisma } from "@/lib/db";
import { pickWorker } from "@/lib/gpu/workers";
import {
  BUILD_VERSION,
  type GpuEnqueueOpts,
  type GpuJobStage,
  type GpuPool,
  type TimelineEvent,
} from "@/lib/gpu/types";

type JobStore = {
  jobId: string;
  workerId: string | null;
  failed: boolean;
};

const als = new AsyncLocalStorage<JobStore>();

function parseTimeline(raw: string): TimelineEvent[] {
  try {
    const v = JSON.parse(raw || "[]");
    return Array.isArray(v) ? (v as TimelineEvent[]) : [];
  } catch {
    return [];
  }
}

async function appendTimeline(jobId: string, stage: string, detail?: string) {
  const job = await prisma.gpuJob.findUnique({ where: { id: jobId } });
  if (!job) return;
  const timeline = parseTimeline(job.timelineJson);
  timeline.push({
    at: new Date().toISOString(),
    stage,
    detail: detail?.slice(0, 400),
  });
  await prisma.gpuJob.update({
    where: { id: jobId },
    data: {
      stage,
      timelineJson: JSON.stringify(timeline.slice(-40)),
    },
  });
}

export function currentGpuJobId(): string | null {
  return als.getStore()?.jobId || null;
}

export async function noteGpuJobStage(stage: GpuJobStage | string, detail?: string) {
  const id = currentGpuJobId();
  if (!id) return;
  await appendTimeline(id, stage, detail).catch(() => undefined);
}

export async function noteGpuJobError(
  message: string,
  meta?: Record<string, unknown>,
) {
  const store = als.getStore();
  if (!store || store.failed) return;
  store.failed = true;
  const msg = (message || "error").slice(0, 2000);
  const job = await prisma.gpuJob.findUnique({ where: { id: store.jobId } });
  if (!job) return;
  const now = new Date();
  const waitMs =
    job.startedAt && job.queuedAt
      ? Math.max(0, job.startedAt.getTime() - job.queuedAt.getTime())
      : job.waitMs;
  const runMs = job.startedAt
    ? Math.max(0, now.getTime() - job.startedAt.getTime())
    : null;
  const timeline = parseTimeline(job.timelineJson);
  timeline.push({ at: now.toISOString(), stage: "error", detail: msg.slice(0, 400) });
  await prisma.gpuJob.update({
    where: { id: store.jobId },
    data: {
      status: "error",
      stage: "error",
      error: msg,
      finishedAt: now,
      waitMs: waitMs ?? undefined,
      runMs: runMs ?? undefined,
      timelineJson: JSON.stringify(timeline.slice(-40)),
      metaJson: JSON.stringify({
        ...safeJson(job.metaJson),
        ...(meta || {}),
        buildVersion: BUILD_VERSION,
      }),
    },
  });
  if (store.workerId) {
    await prisma.gpuWorker
      .update({
        where: { id: store.workerId },
        data: { currentJobId: null, status: "online" },
      })
      .catch(() => undefined);
  }
  void import("@/lib/ops/errors")
    .then(({ reportOpsError }) =>
      reportOpsError({
        kind: job.kind.includes("lora") ? "lora" : job.pool === "video" ? "gpu" : "generation",
        message: msg,
        userId: job.userId,
        stage: "error",
        jobId: job.id,
        refType: job.refType,
        refId: job.refId,
        timeline,
        meta: {
          kind: job.kind,
          pool: job.pool,
          workerId: store.workerId,
          ...(meta || {}),
        },
      }),
    )
    .catch(() => undefined);
}

function safeJson(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw || "{}") as Record<string, unknown>;
  } catch {
    return {};
  }
}

function inferPool(opts?: GpuEnqueueOpts): GpuPool {
  if (opts?.pool) return opts.pool;
  const kind = (opts?.kind || "").toLowerCase();
  if (kind.includes("train") || kind === "lora") return "lora";
  if (
    kind.includes("video") ||
    kind.includes("clip") ||
    kind.includes("film") ||
    kind.includes("i2v") ||
    kind.includes("quick")
  ) {
    return "video";
  }
  if (kind.includes("photo") || kind.includes("identity")) return "photo";
  return "any";
}

/** Create DB job, assign worker, run fn inside ALS context. */
export async function runTrackedGpuJob(
  fn: () => Promise<void>,
  opts?: GpuEnqueueOpts,
): Promise<void> {
  const pool = inferPool(opts);
  const kind = opts?.kind || "other";
  const queuedAt = new Date();
  const job = await prisma.gpuJob.create({
    data: {
      kind,
      pool,
      status: "queued",
      stage: "queued",
      userId: opts?.userId || null,
      refType: opts?.refType || "",
      refId: opts?.refId || "",
      queuedAt,
      timelineJson: JSON.stringify([
        {
          at: queuedAt.toISOString(),
          stage: "queued",
          detail: opts?.title || kind,
        },
      ] satisfies TimelineEvent[]),
      metaJson: JSON.stringify({
        title: opts?.title || "",
        buildVersion: BUILD_VERSION,
        ...(opts?.meta || {}),
      }),
    },
  });

  const worker = await pickWorker(pool);
  const startedAt = new Date();
  const waitMs = Math.max(0, startedAt.getTime() - queuedAt.getTime());
  await prisma.gpuJob.update({
    where: { id: job.id },
    data: {
      status: "running",
      stage: "running",
      workerId: worker.id,
      startedAt,
      waitMs,
      attempt: { increment: 1 },
      timelineJson: JSON.stringify([
        ...parseTimeline(job.timelineJson),
        {
          at: startedAt.toISOString(),
          stage: "assigned",
          detail: worker.label,
        },
        { at: startedAt.toISOString(), stage: "running" },
      ]),
    },
  });
  await prisma.gpuWorker.update({
    where: { id: worker.id },
    data: { status: "busy", currentJobId: job.id },
  });

  const store: JobStore = {
    jobId: job.id,
    workerId: worker.id,
    failed: false,
  };

  await als.run(store, async () => {
    try {
      await fn();
      if (!store.failed) {
        const now = new Date();
        const runMs = Math.max(0, now.getTime() - startedAt.getTime());
        const timeline = parseTimeline(
          (
            await prisma.gpuJob.findUnique({
              where: { id: job.id },
              select: { timelineJson: true },
            })
          )?.timelineJson || "[]",
        );
        timeline.push({ at: now.toISOString(), stage: "done" });
        await prisma.gpuJob.update({
          where: { id: job.id },
          data: {
            status: "done",
            stage: "done",
            finishedAt: now,
            runMs,
            timelineJson: JSON.stringify(timeline.slice(-40)),
          },
        });
      }
    } catch (e) {
      if (!store.failed) {
        await noteGpuJobError(
          e instanceof Error ? e.message : String(e),
          { thrown: true },
        );
      }
      throw e;
    } finally {
      await prisma.gpuWorker
        .update({
          where: { id: worker.id },
          data: {
            currentJobId: null,
            status: "online",
          },
        })
        .catch(() => undefined);
    }
  });
}

export async function getRecentGpuJobs(take = 40) {
  return prisma.gpuJob.findMany({
    orderBy: { queuedAt: "desc" },
    take,
    include: { worker: { select: { label: true, key: true, provider: true } } },
  });
}
