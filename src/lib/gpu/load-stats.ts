import { prisma } from "@/lib/db";
import { mergeSlos, ratioHealth, type FunctionSlo } from "@/lib/gpu/baselines";
import {
  clearBurstRequests,
  providerReadiness,
  requestLoraBurst,
  requestVideoBurst,
} from "@/lib/gpu/burst";
import { listWorkersForOps, heartbeatAllWorkers } from "@/lib/gpu/workers";
import { readTunnelStatusFile } from "@/lib/gpu/tunnel-status";
import { gpuRuntimeSnapshot } from "@/lib/ops/queue";
import { getOpsSettings } from "@/lib/ops/settings";
import { BUILD_VERSION } from "@/lib/gpu/types";

function avg(nums: number[]) {
  if (!nums.length) return 0;
  return Math.round(nums.reduce((a, b) => a + b, 0) / nums.length);
}

function mapKindToSloKey(kind: string): string {
  const k = kind.toLowerCase();
  if (k.includes("train")) return "lora_train";
  if (k.includes("i2v") || k.includes("premium")) return "video_premium";
  if (k.includes("animate")) return "video_animate";
  if (k.includes("story") || k === "video" || k === "clip" || k === "film" || k.includes("quick")) {
    return "video_story";
  }
  if (k.includes("lora") && (k.includes("photo") || k === "photo")) return "photo_lora";
  if (k.includes("identity")) return "photo_actress";
  return "photo_actress";
}

export async function collectLoadDashboard(opts?: { ping?: boolean }) {
  if (opts?.ping !== false) {
    await heartbeatAllWorkers().catch(() => undefined);
  }

  const settings = await getOpsSettings();
  const slos = mergeSlos(settings.sloJson);
  const dayAgo = new Date(Date.now() - 24 * 3600 * 1000);
  const [workers, activeJobs, doneJobs, errorJobs, pendingGallery, busyVideo, trainBusy] =
    await Promise.all([
      listWorkersForOps(),
      prisma.gpuJob.findMany({
        where: { status: { in: ["queued", "assigned", "running"] } },
        orderBy: { queuedAt: "asc" },
        take: 100,
        include: { worker: { select: { label: true, key: true } } },
      }),
      prisma.gpuJob.findMany({
        where: { status: "done", finishedAt: { gte: dayAgo } },
        select: { kind: true, waitMs: true, runMs: true, pool: true },
        take: 500,
      }),
      prisma.gpuJob.count({
        where: { status: "error", finishedAt: { gte: dayAgo } },
      }),
      prisma.galleryItem.count({
        where: { metaJson: { contains: "\"status\":\"pending\"" } },
      }),
      prisma.quickVideoRun.count({ where: { status: "busy" } }),
      prisma.character.count({ where: { loraStatus: "lora_training" } }),
    ]);

  const bySlo = new Map<string, { wait: number[]; run: number[]; inflight: number; queued: number }>();
  for (const s of slos) {
    bySlo.set(s.key, { wait: [], run: [], inflight: 0, queued: 0 });
  }
  for (const j of doneJobs) {
    const key = mapKindToSloKey(j.kind);
    const bucket = bySlo.get(key) || { wait: [], run: [], inflight: 0, queued: 0 };
    if (typeof j.waitMs === "number") bucket.wait.push(j.waitMs);
    if (typeof j.runMs === "number") bucket.run.push(j.runMs);
    bySlo.set(key, bucket);
  }
  for (const j of activeJobs) {
    const key = mapKindToSloKey(j.kind);
    const bucket = bySlo.get(key) || { wait: [], run: [], inflight: 0, queued: 0 };
    if (j.status === "queued") bucket.queued += 1;
    else bucket.inflight += 1;
    bySlo.set(key, bucket);
  }

  const functions = slos.map((s: FunctionSlo) => {
    const b = bySlo.get(s.key) || { wait: [], run: [], inflight: 0, queued: 0 };
    const avgWait = avg(b.wait);
    const avgRun = avg(b.run);
    const waitHealth = ratioHealth(avgWait || (b.queued > 0 ? s.waitMs * 1.3 : 0), s.waitMs);
    const runHealth = ratioHealth(avgRun, s.runMs);
    const health =
      waitHealth === "danger" || runHealth === "danger"
        ? "danger"
        : waitHealth === "warn" || runHealth === "warn"
          ? "warn"
          : "ok";
    return {
      key: s.key,
      title: s.title,
      pool: s.pool,
      inflight: b.inflight,
      queued: b.queued,
      avgWaitMs: avgWait,
      avgRunMs: avgRun,
      baselineWaitMs: s.waitMs,
      baselineRunMs: s.runMs,
      waitRatio: s.waitMs ? Math.round((avgWait / s.waitMs) * 100) : 0,
      runRatio: s.runMs ? Math.round((avgRun / s.runMs) * 100) : 0,
      health,
    };
  });

  const liveWorkers = workers.filter((w) => w.enabled && w.comfyUrl);
  const online = liveWorkers.filter((w) => w.status === "online" || w.status === "busy").length;
  const dead = liveWorkers.filter((w) => w.status === "dead" || w.status === "offline").length;
  const mem = gpuRuntimeSnapshot();
  const tunnel = readTunnelStatusFile();

  let orch: Record<string, unknown> = {};
  try {
    orch = JSON.parse(settings.gpuOrchestratorJson || "{}") as Record<string, unknown>;
  } catch {
    orch = {};
  }

  const worst = functions.reduce<"ok" | "warn" | "danger">((acc, f) => {
    if (f.health === "danger" || acc === "danger") return "danger";
    if (f.health === "warn" || acc === "warn") return "warn";
    return "ok";
  }, "ok");

  const tunnelDown = Boolean(tunnel && tunnel.ok === false && tunnel.error);
  const summaryHealth =
    dead > 0 || tunnelDown ? "danger" : worst;

  return {
    build: BUILD_VERSION,
    at: new Date().toISOString(),
    summary: {
      health: summaryHealth,
      workersOnline: online,
      workersDead: dead,
      workersTotal: liveWorkers.length,
      jobsInflight: activeJobs.filter((j) => j.status !== "queued").length,
      jobsQueued: activeJobs.filter((j) => j.status === "queued").length,
      errors24h: errorJobs,
      pendingGallery,
      busyVideo,
      training: trainBusy,
      processBusy: mem.running,
      processBusyForMs: mem.runningForMs,
      avgProcessJobMs24h: mem.avgJobMs24h,
      maintenance: settings.maintenance,
      loadMode: settings.loadMode,
      tunnelError: tunnelDown ? String(tunnel?.error || "") : "",
    },
    tunnel: tunnel
      ? {
          ok: Boolean(tunnel.ok),
          reason: tunnel.reason || "",
          error: tunnel.error || "",
          updatedAt: tunnel.updatedAt || null,
          host: tunnel.host || null,
          sshPort: tunnel.sshPort ?? null,
        }
      : null,
    workers: workers.map((w) => {
      let meta: Record<string, unknown> = {};
      try {
        meta = JSON.parse(w.metaJson || "{}") as Record<string, unknown>;
      } catch {
        meta = {};
      }
      const current = activeJobs.find((j) => j.id === w.currentJobId);
      return {
        id: w.id,
        key: w.key,
        label: w.label,
        provider: w.provider,
        pool: w.pool,
        enabled: w.enabled,
        status: w.status,
        comfyUrl: w.comfyUrl ? w.comfyUrl.replace(/\/\/.*@/, "//***@") : "",
        lastHeartbeatAt: w.lastHeartbeatAt?.toISOString() || null,
        lastError: w.lastError,
        costRubPerHour: w.costRubPerHour,
        currentJob: current
          ? {
              id: current.id,
              kind: current.kind,
              stage: current.stage,
              userId: current.userId,
              queuedAt: current.queuedAt.toISOString(),
              startedAt: current.startedAt?.toISOString() || null,
            }
          : null,
        needsProvider: w.status === "pending_provider" || !w.enabled,
        meta,
      };
    }),
    functions,
    activeJobs: activeJobs.slice(0, 30).map((j) => ({
      id: j.id,
      kind: j.kind,
      pool: j.pool,
      status: j.status,
      stage: j.stage,
      userId: j.userId,
      worker: j.worker?.label || null,
      queuedAt: j.queuedAt.toISOString(),
      startedAt: j.startedAt?.toISOString() || null,
      waitMs: j.startedAt
        ? Math.max(0, j.startedAt.getTime() - j.queuedAt.getTime())
        : Math.max(0, Date.now() - j.queuedAt.getTime()),
    })),
    orchestrator: orch,
    providerReady: providerReadiness(),
  };
}

export async function applyLoadAction(
  action: string,
  actorId: string,
): Promise<{ ok: boolean; message: string }> {
  if (action === "request_burst_video") {
    return requestVideoBurst(actorId);
  }

  if (action === "request_burst_lora") {
    return requestLoraBurst(actorId);
  }

  if (action === "clear_burst_requests") {
    return clearBurstRequests();
  }

  if (action === "heartbeat_now") {
    await heartbeatAllWorkers();
    return { ok: true, message: "Проверка GPU выполнена." };
  }

  return { ok: false, message: "Неизвестное действие" };
}
