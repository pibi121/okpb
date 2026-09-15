import { prisma } from "@/lib/db";
import { comfyBaseUrl, loadMetalnodeConfig } from "@/lib/metalnode-config";
import type { GpuPool } from "@/lib/gpu/types";
import { FLEET_EXTRA_GPUS, fleetComfyUrl, fleetConfigured } from "@/lib/gpu/fleet";

const PRIMARY_KEY = "metalnode-primary";

export async function ensurePrimaryWorker() {
  const cfg = loadMetalnodeConfig();
  const url = comfyBaseUrl() || cfg.comfyUrl || "http://127.0.0.1:8188";
  const cost = Number(process.env.GPU_COST_RUB_PER_HOUR || 55);
  return prisma.gpuWorker.upsert({
    where: { key: PRIMARY_KEY },
    create: {
      key: PRIMARY_KEY,
      label: "Metalnode bmserv5 (основная)",
      provider: "metalnode",
      pool: "any",
      comfyUrl: url,
      enabled: true,
      status: "unknown",
      costRubPerHour: Number.isFinite(cost) && cost > 0 ? Math.round(cost) : 55,
      metaJson: JSON.stringify({
        host: cfg.host,
        sshPort: cfg.sshPort,
        role: "always_on",
        server: "bmserv5",
      }),
    },
    update: {
      comfyUrl: url,
      label: "Metalnode bmserv5 (основная)",
      provider: "metalnode",
      metaJson: JSON.stringify({
        host: cfg.host,
        sshPort: cfg.sshPort,
        role: "always_on",
        server: "bmserv5",
      }),
    },
  });
}

/** Register extra Metalnode cards when their SSH keys are present in env. */
export async function ensureFleetWorkers() {
  const cfg = loadMetalnodeConfig();
  const cost = Number(process.env.GPU_COST_RUB_PER_HOUR || 55);
  const rub = Number.isFinite(cost) && cost > 0 ? Math.round(cost) : 55;
  for (const g of FLEET_EXTRA_GPUS) {
    const hasKey = fleetConfigured(g);
    const url = fleetComfyUrl(g);
    const metaJson = JSON.stringify({
      host: g.host || cfg.host || process.env.METALNODE_HOST || "",
      sshPort: g.sshPort,
      localPort: g.localPort,
      role: g.loraPreferred ? "lora_preferred" : "fleet",
      server: g.key,
      keyEnv: g.keyEnv,
    });
    await prisma.gpuWorker.upsert({
      where: { key: g.key },
      create: {
        key: g.key,
        label: g.label,
        provider: "metalnode",
        pool: g.pool,
        comfyUrl: hasKey ? url : "",
        enabled: hasKey,
        status: hasKey ? "unknown" : "pending_provider",
        costRubPerHour: rub,
        metaJson,
      },
      update: {
        label: g.label,
        provider: "metalnode",
        pool: g.pool,
        comfyUrl: hasKey ? url : "",
        enabled: hasKey,
        ...(hasKey ? {} : { status: "pending_provider" }),
        costRubPerHour: rub,
        metaJson,
      },
    });
  }
}

/** Placeholder slots so /ops/load shows future pools before provider keys exist. */
export async function ensurePlaceholderWorkers() {
  await ensurePrimaryWorker();
  await ensureFleetWorkers();
  await prisma.gpuWorker.upsert({
    where: { key: "burst-video-slot" },
    create: {
      key: "burst-video-slot",
      label: "Пик видео (RunPod) — не подключено",
      provider: "runpod",
      pool: "video",
      comfyUrl: "",
      enabled: false,
      status: "pending_provider",
      costRubPerHour: 80,
      metaJson: JSON.stringify({
        role: "burst",
        needs: ["RUNPOD_API_KEY", "RUNPOD_TEMPLATE_ID", "RUNPOD_VOLUME_ID"],
      }),
    },
    update: {},
  });
  await prisma.gpuWorker.upsert({
    where: { key: "burst-lora-slot" },
    create: {
      key: "burst-lora-slot",
      label: "LoRA burst — не подключено",
      provider: "vast",
      pool: "lora",
      comfyUrl: "",
      enabled: false,
      status: "pending_provider",
      costRubPerHour: 40,
      metaJson: JSON.stringify({
        role: "lora_burst",
        needs: ["VAST_API_KEY or RUNPOD train template"],
      }),
    },
    update: {},
  });
}

export async function pingWorkerComfy(comfyUrl: string): Promise<{
  ok: boolean;
  detail: string;
  running?: number;
  pending?: number;
}> {
  if (!comfyUrl) {
    return { ok: false, detail: "нет URL Comfy" };
  }
  try {
    const stats = await fetch(`${comfyUrl.replace(/\/$/, "")}/system_stats`, {
      signal: AbortSignal.timeout(4000),
    });
    if (!stats.ok) {
      return { ok: false, detail: `system_stats HTTP ${stats.status}` };
    }
    let running = 0;
    let pending = 0;
    try {
      const q = await fetch(`${comfyUrl.replace(/\/$/, "")}/queue`, {
        signal: AbortSignal.timeout(4000),
      });
      if (q.ok) {
        const body = (await q.json()) as {
          queue_running?: unknown[];
          queue_pending?: unknown[];
        };
        running = body.queue_running?.length || 0;
        pending = body.queue_pending?.length || 0;
      }
    } catch {
      /* ignore queue probe */
    }
    return {
      ok: true,
      detail: running || pending ? `Comfy: ${running} run / ${pending} wait` : "Comfy online",
      running,
      pending,
    };
  } catch (e) {
    return {
      ok: false,
      detail: e instanceof Error ? e.message.slice(0, 160) : "Comfy offline",
    };
  }
}

export async function heartbeatAllWorkers() {
  await ensurePlaceholderWorkers();
  try {
    const { sweepStaleGpuJobs } = await import("@/lib/gpu/worker-admin");
    const n = await sweepStaleGpuJobs();
    if (n > 0) console.warn(`[peach] swept ${n} stale gpu job(s)`);
  } catch (e) {
    console.error("[peach] stale gpu sweep:", e);
  }
  const workers = await prisma.gpuWorker.findMany({
    where: { enabled: true },
  });
  const now = new Date();
  const { readTunnelStatusFile } = await import("@/lib/gpu/tunnel-status");
  const tunnel = readTunnelStatusFile();
  for (const w of workers) {
    if (w.status === "pending_provider" || !w.comfyUrl) continue;
    const ping = await pingWorkerComfy(w.comfyUrl);
    const busyJob = w.currentJobId
      ? await prisma.gpuJob.findFirst({
          where: { id: w.currentJobId, status: { in: ["assigned", "running"] } },
        })
      : null;
    let status = ping.ok ? (busyJob ? "busy" : "online") : "dead";
    if (ping.ok && (ping.running || 0) > 0 && !busyJob) status = "busy";
    // Clear dangling currentJobId if ledger row already finished.
    if (w.currentJobId && !busyJob) {
      await prisma.gpuWorker.update({
        where: { id: w.id },
        data: { currentJobId: null },
      });
    }
    let lastError = ping.ok ? "" : ping.detail;
    if (!ping.ok && tunnel?.error && w.key === "metalnode-primary") {
      lastError = tunnel.error;
    }
    await prisma.gpuWorker.update({
      where: { id: w.id },
      data: {
        status,
        lastHeartbeatAt: now,
        lastError,
        metaJson: JSON.stringify({
          ...safeJson(w.metaJson),
          lastPing: ping,
          tunnel: tunnel || null,
        }),
      },
    });
  }
  // Disabled placeholders keep pending_provider
  await prisma.gpuWorker.updateMany({
    where: { enabled: false, status: { not: "pending_provider" }, comfyUrl: "" },
    data: { status: "pending_provider" },
  });
}

function safeJson(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw || "{}") as Record<string, unknown>;
  } catch {
    return {};
  }
}

export async function pickWorker(pool: GpuPool) {
  await ensurePrimaryWorker();
  await ensureFleetWorkers();
  const candidates = await prisma.gpuWorker.findMany({
    where: {
      enabled: true,
      status: { in: ["online", "busy", "unknown"] },
      OR: [{ pool: "any" }, { pool }],
    },
    orderBy: { updatedAt: "asc" },
  });
  const live = candidates.filter((w) => w.comfyUrl && w.status !== "dead");
  if (!live.length) {
    // Fall back to primary even if marked dead — better than hard fail.
    return ensurePrimaryWorker();
  }
  const free = live.filter((w) => w.status === "online" || w.status === "unknown");
  if (free.length) return free[0];
  // All busy — still pick least-recently-updated; Comfy will queue on that card.
  return live[0];
}

export async function listWorkersForOps() {
  await ensurePlaceholderWorkers();
  return prisma.gpuWorker.findMany({ orderBy: { createdAt: "asc" } });
}
