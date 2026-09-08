/**
 * Keep Comfy :8188 alive during a testing session.
 * Restarts tunnel (openssh / paramiko / ssh2) if system_stats fails twice in a row.
 *
 *   node scripts/comfy-tunnel-watchdog.mjs
 */
import http from "node:http";
import { ensureComfyTunnel } from "./railway-comfy-tunnel.mjs";

const TICK_MS = 15_000;
const FAIL_BEFORE_RESTART = 2;

function pingComfy(timeoutMs = 4000) {
  return new Promise((resolve) => {
    const req = http.get(
      "http://127.0.0.1:8188/system_stats",
      { timeout: timeoutMs },
      (res) => {
        res.resume();
        const code = res.statusCode || 0;
        resolve(code >= 200 && code < 500);
      },
    );
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function restartTunnel() {
  console.log(`[watchdog] ${new Date().toISOString()} comfy down → ensureComfyTunnel`);
  try {
    const r = await ensureComfyTunnel();
    console.log(`[watchdog] tunnel result: ${r.reason} ok=${r.ok}`);
  } catch (e) {
    console.error(
      `[watchdog] tunnel restart failed:`,
      e instanceof Error ? e.message : e,
    );
  }
}

let fails = 0;
console.log(`[watchdog] started, tick=${TICK_MS}ms`);

setInterval(async () => {
  const ok = await pingComfy();
  if (ok) {
    if (fails > 0) console.log(`[watchdog] ${new Date().toISOString()} comfy OK again`);
    fails = 0;
    return;
  }
  fails += 1;
  console.log(`[watchdog] ${new Date().toISOString()} comfy ping fail (${fails})`);
  if (fails >= FAIL_BEFORE_RESTART) {
    await restartTunnel();
    fails = 0;
  }
}, TICK_MS);
