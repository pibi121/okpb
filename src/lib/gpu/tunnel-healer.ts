/**
 * In-process healer (Next.js):
 * - reads /tmp/peach-tunnel-status.json escalate flag → ops alert
 * - periodically sweeps stale GpuJobs / pending gallery when Comfy idle
 * - does NOT spawn tunnel processes on Railway (watchdog owns that)
 */
import fs from "node:fs";
import http from "node:http";
import { comfyBaseUrl } from "@/lib/metalnode-config";
import { FLEET_EXTRA_GPUS, fleetComfyUrl, fleetConfigured } from "@/lib/gpu/fleet";

const STATUS_PATH =
  process.env.PEACH_TUNNEL_STATUS_PATH || "/tmp/peach-tunnel-status.json";
const TICK_MS = Math.max(
  20_000,
  Number(process.env.PEACH_TUNNEL_HEALER_MS || 45_000) || 45_000,
);
/** Video/clip jobs stuck this long with idle Comfy → fail + alert */
const STUCK_VIDEO_MS = Math.max(
  12 * 60_000,
  Number(process.env.PEACH_STUCK_VIDEO_MS || 22 * 60_000) || 22 * 60_000,
);
const STUCK_PHOTO_MS = Math.max(
  5 * 60_000,
  Number(process.env.PEACH_STUCK_PHOTO_MS || 10 * 60_000) || 10 * 60_000,
);

let started = false;
let lastEscalateAlertAt = 0;
let idleComfyStreak = 0;

function allComfyBases(): string[] {
  const bases = new Set<string>();
  const primary = (comfyBaseUrl() || "http://127.0.0.1:8188").replace(/\/$/, "");
  bases.add(primary);
  for (const g of FLEET_EXTRA_GPUS) {
    if (!fleetConfigured(g)) continue;
    bases.add(fleetComfyUrl(g).replace(/\/$/, ""));
  }
  return [...bases];
}

function pingComfyUrl(base: string, timeoutMs = 4000): Promise<boolean> {
  const url = `${base}/system_stats`;
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      res.resume();
      resolve((res.statusCode || 0) >= 200 && (res.statusCode || 0) < 500);
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
}

/** True if any reachable Comfy is up (primary or fleet). */
async function anyComfyUp(): Promise<boolean> {
  const results = await Promise.all(allComfyBases().map((b) => pingComfyUrl(b)));
  return results.some(Boolean);
}

function queueBusy(base: string, timeoutMs = 5000): Promise<boolean | null> {
  const url = `${base}/queue`;
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
            queue_running?: unknown[];
            queue_pending?: unknown[];
          };
          const running = body.queue_running?.length || 0;
          const pending = body.queue_pending?.length || 0;
          resolve(running + pending > 0);
        } catch {
          resolve(null);
        }
      });
    });
    req.on("error", () => resolve(null));
    req.on("timeout", () => {
      req.destroy();
      resolve(null);
    });
  });
}

/**
 * Fleet-aware idle check:
 * - true  → at least one Comfy reachable AND every reachable queue is empty
 * - false → some reachable Comfy still has work (do NOT fail jobs)
 * - null  → no queue could be read
 */
async function allReachableQueuesIdle(): Promise<boolean | null> {
  const bases = allComfyBases();
  const results = await Promise.all(bases.map((b) => queueBusy(b)));
  const known = results.filter((v): v is boolean => v !== null);
  if (!known.length) return null;
  if (known.some((busy) => busy)) return false;
  return true;
}

function readStatus(): {
  ok?: boolean;
  escalate?: boolean;
  error?: string;
  reason?: string;
} | null {
  try {
    if (!fs.existsSync(STATUS_PATH)) return null;
    return JSON.parse(fs.readFileSync(STATUS_PATH, "utf8"));
  } catch {
    return null;
  }
}

async function alertEscalate(status: {
  escalate?: boolean;
  error?: string;
  reason?: string;
}) {
  if (!status.escalate) return;
  if (Date.now() - lastEscalateAlertAt < 30 * 60_000) return;
  lastEscalateAlertAt = Date.now();
  try {
    const { reportOpsError } = await import("@/lib/ops/errors");
    await reportOpsError({
      kind: "gpu",
      stage: "tunnel_escalate",
      message:
        status.error ||
        status.reason ||
        "Comfy tunnel escalate — GPU/SSH unreachable too long",
      meta: { status },
    });
  } catch (e) {
    console.error("[peach] tunnel-healer escalate alert failed:", e);
  }
}

async function failStuckJobs(comfyUp: boolean, queueIdle: boolean | null) {
  // Only fail early when we can see ALL reachable Comfy queues are idle
  // (or completely down for a while). Fleet gens run on :8189 — checking only
  // primary :8188 caused false "stuck" kills while bmserv4 was busy.
  if (comfyUp && queueIdle === false) {
    idleComfyStreak = 0;
    return 0;
  }
  if (comfyUp && queueIdle === true) idleComfyStreak += 1;
  else if (!comfyUp) idleComfyStreak += 1;
  else idleComfyStreak = 0;

  // Need 2 consecutive idle/down ticks before failing "running" ledger rows early.
  if (idleComfyStreak < 2) return 0;

  const { prisma } = await import("@/lib/db");
  const now = Date.now();
  const active = await prisma.gpuJob.findMany({
    where: { status: { in: ["queued", "assigned", "running"] } },
    take: 40,
  });
  let n = 0;
  for (const job of active) {
    const started = (job.startedAt || job.queuedAt).getTime();
    const age = now - started;
    const isVideo =
      job.pool === "video" ||
      /video|clip|film|i2v|quick|animate/i.test(`${job.kind} ${job.pool}`);
    const limit = isVideo ? STUCK_VIDEO_MS : STUCK_PHOTO_MS;
    if (age < limit) continue;

    const mins = Math.round(age / 60_000);
    const reason = !comfyUp
      ? `tunnel/Comfy down — job stuck ${mins} min`
      : `Comfy idle but job still running ${mins} min (healer)`;

    await prisma.gpuJob.update({
      where: { id: job.id },
      data: {
        status: "error",
        stage: "error",
        error: reason,
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
    if (job.refType === "galleryItem" && job.refId) {
      try {
        const item = await prisma.galleryItem.findUnique({
          where: { id: job.refId },
        });
        if (item) {
          let meta: Record<string, unknown> = {};
          try {
            meta = JSON.parse(item.metaJson || "{}") as Record<string, unknown>;
          } catch {
            meta = {};
          }
          if (meta.status === "pending" || meta.status === "busy") {
            await prisma.galleryItem.update({
              where: { id: item.id },
              data: {
                metaJson: JSON.stringify({
                  ...meta,
                  status: "error",
                  error: "Связь с GPU оборвалась — нажми Повторить",
                  healerAt: new Date().toISOString(),
                }),
              },
            });
          }
        }
      } catch {
        /* ignore */
      }
    }
    try {
      const { reportOpsError } = await import("@/lib/ops/errors");
      await reportOpsError({
        kind: "gpu",
        stage: "stuck_job_healer",
        message: reason,
        jobId: job.id,
        refType: job.refType || undefined,
        refId: job.refId || undefined,
        meta: { kind: job.kind, pool: job.pool, comfyUp, queueIdle },
      });
    } catch {
      /* ignore */
    }
    n += 1;
  }
  return n;
}

async function tick() {
  try {
    const status = readStatus();
    if (status) await alertEscalate(status);

    const comfyUp = await anyComfyUp();
    const queueIdle = comfyUp ? await allReachableQueuesIdle() : null;

    // Soft wait for tunnel — never spawn on Railway from here.
    if (!comfyUp) {
      try {
        const { ensureComfyTunnel } = await import("@/lib/ensure-comfy-tunnel");
        await ensureComfyTunnel({ waitMs: 20_000 });
      } catch {
        /* ignore */
      }
    }

    const failed = await failStuckJobs(comfyUp, queueIdle);
    if (failed > 0) {
      console.warn(`[peach] tunnel-healer: marked ${failed} stuck GpuJob(s)`);
    }

    // Also run the existing soft stale sweeper occasionally.
    try {
      const { sweepStaleGpuJobs } = await import("@/lib/gpu/worker-admin");
      const stale = await sweepStaleGpuJobs();
      if (stale > 0) {
        console.warn(`[peach] tunnel-healer: stale sweep ${stale}`);
      }
    } catch {
      /* ignore */
    }
  } catch (e) {
    console.error(
      "[peach] tunnel-healer tick:",
      e instanceof Error ? e.message : e,
    );
  }
}

export function startTunnelHealer() {
  if (started) return;
  if (process.env.COMFY_FORCE_MOCK === "1") return;
  if (process.env.PEACH_USE_COMFY === "0") return;
  started = true;
  console.log(`[peach] tunnel-healer started tick=${TICK_MS}ms`);
  setTimeout(() => void tick(), 35_000);
  setInterval(() => void tick(), TICK_MS);
}
