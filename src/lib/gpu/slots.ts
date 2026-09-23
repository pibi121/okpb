/**
 * Concurrent GPU slots — allows undress/photo to run while video uses another worker.
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

async function liveWorkerCap(): Promise<number> {
  if (Date.now() - capAt < 8_000 && cachedCap >= 1) return cachedCap;
  const rows = await prisma.gpuWorker.findMany({
    where: {
      enabled: true,
      status: { in: ["online", "busy", "unknown"] },
      NOT: { comfyUrl: "" },
    },
    select: { id: true },
  });
  cachedCap = Math.max(1, rows.length);
  capAt = Date.now();
  return cachedCap;
}

export function invalidateGpuSlotCap() {
  capAt = 0;
}

export async function acquireGpuSlot(): Promise<void> {
  const cap = await liveWorkerCap();
  if (active < cap) {
    active += 1;
    return;
  }
  await new Promise<void>((resolve) => {
    waiters.push({ resolve, enqueuedAt: Date.now() });
  });
  active += 1;
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
