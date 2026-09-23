/** In-process GPU queue snapshot (supports multi-worker concurrency). */

type Sample = { ms: number; at: number };

let running = 0;
let lastStart = 0;
const samples: Sample[] = [];

export function gpuQueueOnStart() {
  running += 1;
  lastStart = Date.now();
}

export function gpuQueueOnFinish() {
  if (lastStart) {
    samples.push({ ms: Date.now() - lastStart, at: Date.now() });
    if (samples.length > 200) samples.shift();
  }
  running = Math.max(0, running - 1);
  if (running === 0) lastStart = 0;
}

export function gpuRuntimeSnapshot() {
  const recent = samples.filter((s) => Date.now() - s.at < 24 * 3600 * 1000);
  const avg =
    recent.length > 0
      ? Math.round(recent.reduce((a, s) => a + s.ms, 0) / recent.length)
      : 0;
  return {
    running: running > 0,
    runningCount: running,
    lastStart: lastStart || null,
    runningForMs: running && lastStart ? Date.now() - lastStart : 0,
    avgJobMs24h: avg,
    jobs24h: recent.length,
  };
}
