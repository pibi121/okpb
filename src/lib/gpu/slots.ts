/**
 * Concurrent GPU slots — undress/photo can run while video holds another worker.
 * Cap = number of live Comfy workers (min 1). Single Metalnode stays serial.
 */
import { prisma } from "@/lib/db";

type Waiter = {
  resolve: () => void;
  enqueuedAt: number;
};

let active = 0;
let waiters: Waiter[] = [];
let cachedCap = 1;
let capAt = 0;
let capEpoch = 0;

async function liveWorkerCap(force = false): Promise<number> {
  if (!force && Date.now() - capAt < 5_000 && cachedCap >= 1) return cachedCap;
  const rows = await prisma.gpuWorker.findMany({
    where: {
      enabled: true,
      status: { in: ["online", "busy", "unknown"] },
      NOT: { comfyUrl: "" },
    },
    select: { id: true },
  });
  const next = Math.max(1, rows.length);
  if (next !== cachedCap) {
    cachedCap = next;
    capEpoch += 1;
  } else {
    cachedCap = next;
  }
  capAt = Date.now();
  return cachedCap;
}

/** Call after RunPod spawn/clear so waiters can take the new capacity. */
export function invalidateGpuSlotCap() {
  capAt = 0;
  capEpoch += 1;
  // Wake one waiter to re-check cap; they re-queue if still full.
  const next = waiters.shift();
  if (next) next.resolve();
}

export async function acquireGpuSlot(): Promise<void> {
  for (;;) {
    const cap = await liveWorkerCap();
    if (active < cap) {
      active += 1;
      return;
    }
    const epochAtWait = capEpoch;
    await new Promise<void>((resolve) => {
      waiters.push({ resolve, enqueuedAt: Date.now() });
    });
    // Cap may have grown (burst online) — loop and try again without
    // incrementing active until we actually take a slot.
    if (capEpoch !== epochAtWait) {
      await liveWorkerCap(true);
    }
  }
}

export function releaseGpuSlot() {
  active = Math.max(0, active - 1);
  const next = waiters.shift();
  if (next) next.resolve();
}

export function gpuSlotSnapshot() {
  return {
    active,
    waiting: waiters.length,
    cap: cachedCap,
    oldestWaitMs: waiters[0] ? Date.now() - waiters[0].enqueuedAt : 0,
  };
}
