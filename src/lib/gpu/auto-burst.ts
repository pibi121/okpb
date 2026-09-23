/**
 * Auto GPU burst: when live queue wait exceeds SLO, rent RunPod (and clear when calm).
 * Manual Ops buttons remain; this runs without operator click.
 */
import { collectLoadDashboard } from "@/lib/gpu/load-stats";
import {
  clearBurstRequests,
  requestVideoBurst,
} from "@/lib/gpu/burst";
import { sloForKind } from "@/lib/gpu/baselines";
import { getOpsSettings, saveOpsSettings } from "@/lib/ops/settings";

const TICK_MS = 45_000;
const SPAWN_COOLDOWN_MS = 12 * 60_000;
const CLEAR_CALM_MS = 5 * 60_000;
const WAIT_RATIO_TRIGGER = 1.2;
/** Queue depth that alone warrants burst when only primary GPU is live. */
const QUEUE_DEPTH_TRIGGER = 2;

type AutoBurstState = {
  lastSpawnAt: number;
  calmSince: number | null;
  lastActionAt: number;
  lastMessage: string;
};

function parseOrch(raw: string | null | undefined): Record<string, unknown> {
  try {
    return JSON.parse(raw || "{}") as Record<string, unknown>;
  } catch {
    return {};
  }
}

let started = false;
const mem: AutoBurstState = {
  lastSpawnAt: 0,
  calmSince: null,
  lastActionAt: 0,
  lastMessage: "",
};

function autoBurstDisabled() {
  return process.env.GPU_AUTO_BURST === "0";
}

function burstAlreadyActive(
  orch: Record<string, unknown>,
  workers: Array<{ key: string; enabled: boolean; status: string }>,
): boolean {
  const pending = orch.pendingBurstVideo as
    | { status?: string; podId?: string; at?: string }
    | undefined;
  if (pending?.podId && pending.status && !/fail|cleared|error/i.test(pending.status)) {
    return true;
  }
  const slot = workers.find((w) => w.key === "burst-video-slot");
  if (!slot) return false;
  if (slot.enabled && ["online", "busy", "booting", "unknown"].includes(slot.status)) {
    return true;
  }
  return false;
}

function evaluatePressure(dash: Awaited<ReturnType<typeof collectLoadDashboard>>): {
  needBurst: boolean;
  reason: string;
  calm: boolean;
} {
  const reasons: string[] = [];

  for (const job of dash.activeJobs) {
    const slo = sloForKind(job.kind);
    if (slo.pool === "lora") continue;
    const wait = job.waitMs || 0;
    if (wait >= slo.waitMs * WAIT_RATIO_TRIGGER) {
      reasons.push(
        `${job.kind} wait ${Math.round(wait / 1000)}s > SLO ${Math.round(slo.waitMs / 1000)}s`,
      );
    }
  }

  for (const fn of dash.functions) {
    if (fn.pool === "lora") continue;
    if (fn.health === "danger" && (fn.queued > 0 || fn.inflight > 0)) {
      reasons.push(`${fn.key} health=danger q=${fn.queued}`);
    }
  }

  const liveGenWorkers = dash.workers.filter(
    (w) =>
      w.enabled &&
      w.comfyUrl &&
      ["online", "busy", "unknown"].includes(w.status) &&
      w.pool !== "lora",
  ).length;
  const queued = dash.summary.jobsQueued;
  if (queued >= QUEUE_DEPTH_TRIGGER && liveGenWorkers <= 1) {
    reasons.push(`queue=${queued} workers=${liveGenWorkers}`);
  }

  const needBurst = reasons.length > 0;
  const calm =
    !needBurst &&
    queued === 0 &&
    dash.summary.jobsInflight <= 1 &&
    dash.functions.every((f) => f.pool === "lora" || f.health === "ok");

  return {
    needBurst,
    reason: reasons.slice(0, 3).join("; ") || "ok",
    calm,
  };
}

export async function tickAutoBurst(): Promise<void> {
  if (autoBurstDisabled()) return;
  if (process.env.PEACH_USE_COMFY === "0") return;

  try {
    const dash = await collectLoadDashboard({ ping: false });
    if (dash.summary.maintenance) return;

    const settings = await getOpsSettings();
    const orch = parseOrch(settings.gpuOrchestratorJson);
    const pressure = evaluatePressure(dash);
    const active = burstAlreadyActive(orch, dash.workers);
    const now = Date.now();

    if (pressure.needBurst && !active) {
      mem.calmSince = null;
      if (now - mem.lastSpawnAt < SPAWN_COOLDOWN_MS) return;
      if (!dash.providerReady.runpodSpawnReady) {
        console.warn(
          "[auto-burst] need GPU but RunPod not ready:",
          dash.providerReady.runpodMissing,
        );
        return;
      }
      mem.lastSpawnAt = now;
      mem.lastActionAt = now;
      const result = await requestVideoBurst("auto-slo");
      mem.lastMessage = result.message;
      orch.autoBurst = {
        at: new Date().toISOString(),
        reason: pressure.reason,
        ok: result.ok,
        message: result.message.slice(0, 400),
      };
      await saveOpsSettings({ gpuOrchestratorJson: JSON.stringify(orch) });
      console.warn(
        `[auto-burst] spawn ok=${result.ok} reason=${pressure.reason} msg=${result.message}`,
      );
      void import("@/lib/ops/ops-telegram")
        .then(({ notifyOpsErrorBg }) =>
          notifyOpsErrorBg({
            kind: "gpu",
            title: "Авто-докупка GPU",
            message: `${pressure.reason}. ${result.message}`.slice(0, 500),
            count: 1,
            fingerprint: `auto-burst:${pressure.reason.slice(0, 80)}`,
            stage: "auto-burst",
          }),
        )
        .catch(() => undefined);
      return;
    }

    if (active && pressure.calm) {
      if (mem.calmSince == null) mem.calmSince = now;
      if (now - mem.calmSince < CLEAR_CALM_MS) return;
      mem.calmSince = null;
      mem.lastActionAt = now;
      const cleared = await clearBurstRequests();
      mem.lastMessage = cleared.message;
      console.warn(`[auto-burst] clear after calm: ${cleared.message}`);
      return;
    }

    if (!pressure.calm) mem.calmSince = null;
  } catch (e) {
    console.error(
      "[auto-burst] tick failed:",
      e instanceof Error ? e.message : e,
    );
  }
}

export function startAutoBurstWatcher() {
  if (started) return;
  if (autoBurstDisabled()) {
    console.log("[auto-burst] disabled (GPU_AUTO_BURST=0 or DRY_RUN)");
    return;
  }
  started = true;
  setTimeout(() => void tickAutoBurst(), 40_000);
  setInterval(() => void tickAutoBurst(), TICK_MS);
  console.log(`[auto-burst] watcher started every ${TICK_MS / 1000}s`);
}
