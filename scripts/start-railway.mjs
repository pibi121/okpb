/**
 * Railway production: SSH tunnel to GPU Comfy, then Next.js + Telegram bot.
 * Web OOM must not kill the bot — restart Next separately.
 *
 * Env:
 *   RAILWAY_ROLE=all|web|bot  (default all)
 *   SEED_TG_CATALOG=1         seed catalog on boot (default off)
 */
import { spawn } from "node:child_process";
import http from "node:http";
import { ensureComfyTunnel } from "./railway-comfy-tunnel.mjs";

/** @type {Map<string, import("node:child_process").ChildProcess>} */
const children = new Map();
let shuttingDown = false;

const ROLE = String(process.env.RAILWAY_ROLE || "all").toLowerCase();
const NEED_WEB = ROLE === "all" || ROLE === "web";
const NEED_BOT = ROLE === "all" || ROLE === "bot";
const COMFY_BASE = (
  process.env.COMFY_URL || "http://127.0.0.1:8188"
).replace(/\/$/, "");

function pingComfy(timeoutMs = 4000) {
  return new Promise((resolve) => {
    const req = http.get(
      `${COMFY_BASE}/system_stats`,
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

async function waitForComfy(ms = 50_000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await pingComfy()) return true;
    await new Promise((r) => setTimeout(r, 1500));
  }
  return false;
}

function run(label, cmd, args, envExtra = {}) {
  const child = spawn(cmd, args, {
    stdio: "inherit",
    shell: true,
    env: { ...process.env, ...envExtra },
  });
  children.set(label, child);
  child.on("exit", (code) => {
    children.delete(label);
    if (code !== 0) console.error(`[railway] ${label} exited with code ${code}`);
  });
  return child;
}

function startBot() {
  return run("bot", "npx", ["tsx", "scripts/tg-bot-dev.ts"], {
    NODE_OPTIONS: "--max-old-space-size=160",
  });
}

function startWeb() {
  const fromEnv = String(process.env.NODE_OPTIONS || "").trim();
  // When bot shares the box, keep Next under ~700; web-only can go higher via env.
  const fallback = NEED_BOT ? 700 : 900;
  const nodeOpts = /\bmax-old-space-size=/.test(fromEnv)
    ? fromEnv
    : `${fromEnv} --max-old-space-size=${fallback}`.trim();
  return run("web", "npm", ["start"], { NODE_OPTIONS: nodeOpts });
}

function restartWeb(delayMs = 2500) {
  if (shuttingDown || !NEED_WEB) return;
  console.log(`[railway] restarting web in ${delayMs}ms…`);
  setTimeout(() => {
    if (shuttingDown) return;
    if (children.has("web")) return;
    startWeb();
    watchWeb();
  }, delayMs);
}

function watchWeb() {
  const web = children.get("web");
  if (!web) return;
  web.on("exit", (code) => {
    if (shuttingDown) return;
    console.error(`[railway] web exit ${code ?? "?"} — restarting web`);
    restartWeb();
  });
}

/** Crash-loop backoff — rapid respawn caused EAGAIN / thread exhaustion on Railway. */
let botRestartDelayMs = 2_000;
let botAliveResetTimer = null;

function watchBot() {
  const bot = children.get("bot");
  if (!bot) return;
  if (botAliveResetTimer) clearTimeout(botAliveResetTimer);
  botAliveResetTimer = setTimeout(() => {
    botRestartDelayMs = 2_000;
  }, 60_000);

  bot.once("exit", (code) => {
    if (botAliveResetTimer) {
      clearTimeout(botAliveResetTimer);
      botAliveResetTimer = null;
    }
    if (shuttingDown) return;
    const delay = botRestartDelayMs;
    botRestartDelayMs = Math.min(60_000, Math.round(botRestartDelayMs * 1.8));
    console.error(
      `[railway] bot exit ${code ?? "?"} — restarting bot in ${delay}ms`,
    );
    setTimeout(() => {
      if (shuttingDown || children.has("bot")) return;
      startBot();
      watchBot();
    }, delay);
  });
}

async function main() {
  const needTunnel = NEED_WEB || NEED_BOT;

  function startComfyWatchdog() {
    // Single owner of the Paramiko/SSH tunnel — managed child (not detached).
    if (process.env.COMFY_FORCE_MOCK === "1") return null;
    if (process.env.PEACH_USE_COMFY === "0") return null;
    if (!process.env.METALNODE_SSH_KEY?.trim()) return null;
    if (children.has("watchdog")) return children.get("watchdog");
    try {
      console.log("[railway] starting comfy watchdog (tunnel owner)…");
      const child = spawn(process.execPath, ["scripts/comfy-tunnel-watchdog.mjs"], {
        cwd: process.cwd(),
        detached: false,
        stdio: "inherit",
        windowsHide: true,
      });
      children.set("watchdog", child);
      child.on("exit", (code) => {
        children.delete("watchdog");
        if (shuttingDown) return;
        console.error(
          `[railway] comfy watchdog exit ${code ?? "?"} — restarting in 4s`,
        );
        setTimeout(() => {
          if (shuttingDown || children.has("watchdog")) return;
          startComfyWatchdog();
        }, 4000);
      });
      return child;
    } catch (e) {
      console.error(
        "[railway] watchdog spawn failed:",
        e instanceof Error ? e.message : e,
      );
      return null;
    }
  }

  function scheduleGpuRetry() {
    const retryMs = 30_000;
    const tick = async () => {
      if (shuttingDown) return;
      try {
        if (await pingComfy()) {
          console.log("[railway] GPU Comfy recovered (ping)");
          return;
        }
        // Watchdog owns the tunnel — do not spawn a second forward from parent.
        if (children.has("watchdog")) {
          console.log("[railway] GPU still down — waiting on watchdog");
        } else {
          const again = await ensureComfyTunnel();
          if (again.ok) {
            console.log(`[railway] GPU Comfy recovered (${again.reason})`);
            return;
          }
        }
      } catch (e) {
        console.error(
          "[railway] GPU retry failed:",
          e instanceof Error ? e.message : e,
        );
      }
      setTimeout(() => void tick(), retryMs);
    };
    setTimeout(() => void tick(), retryMs);
  }

  if (needTunnel) {
    const wd = startComfyWatchdog();
    if (wd) {
      const up = await waitForComfy(55_000);
      if (up) {
        console.log("[railway] GPU Comfy ready (watchdog)");
      } else {
        console.log("[railway] GPU Comfy not ready yet — continuing; watchdog will retry");
        scheduleGpuRetry();
      }
    } else {
      // No watchdog (mock / no key) — try once in-process.
      try {
        const tunnel = await ensureComfyTunnel();
        if (tunnel.ok) {
          console.log(`[railway] GPU Comfy ready (${tunnel.reason})`);
        } else {
          console.log(`[railway] running without GPU tunnel (${tunnel.reason})`);
          scheduleGpuRetry();
        }
      } catch (err) {
        console.error(
          "[railway] GPU tunnel failed (continuing without GPU):",
          err instanceof Error ? err.message : err,
        );
        scheduleGpuRetry();
      }
    }
  }

  console.log(`[railway] role=${ROLE} starting…`);

  if (process.env.SEED_TG_CATALOG === "1") {
    run("bootstrap", "npx", ["tsx", "scripts/seed-tg-catalog.ts"]);
  } else {
    console.log("[railway] skip catalog seed (set SEED_TG_CATALOG=1 to enable)");
  }

  // Bring Mini App up first so auth works even if bot is slow.
  if (NEED_WEB) {
    startWeb();
    watchWeb();
  }

  if (NEED_BOT) {
    const delay = NEED_WEB ? 8000 : 0;
    if (delay) {
      console.log(`[railway] delaying bot start by ${delay}ms (free RAM for web)`);
      setTimeout(() => {
        if (shuttingDown) return;
        startBot();
        watchBot();
      }, delay);
    } else {
      startBot();
      watchBot();
    }
  }

  function shutdown(signal) {
    shuttingDown = true;
    console.log(`[railway] ${signal}, stopping…`);
    for (const child of children.values()) {
      try {
        child.kill("SIGTERM");
      } catch {
        /* ignore */
      }
    }
    setTimeout(() => process.exit(0), 2000);
  }

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  console.error("[railway] fatal:", err);
  process.exit(1);
});
