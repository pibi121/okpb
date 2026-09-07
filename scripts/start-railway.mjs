/**
 * Railway production: SSH tunnel to GPU Comfy, then Next.js + Telegram bot.
 * Web OOM must not kill the bot — restart Next separately.
 *
 * Env:
 *   RAILWAY_ROLE=all|web|bot  (default all)
 *   SEED_TG_CATALOG=1         seed catalog on boot (default off)
 */
import { spawn } from "node:child_process";
import { ensureComfyTunnel } from "./railway-comfy-tunnel.mjs";

/** @type {Map<string, import("node:child_process").ChildProcess>} */
const children = new Map();
let shuttingDown = false;

const ROLE = String(process.env.RAILWAY_ROLE || "all").toLowerCase();
const NEED_WEB = ROLE === "all" || ROLE === "web";
const NEED_BOT = ROLE === "all" || ROLE === "bot";

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

function watchBot() {
  const bot = children.get("bot");
  if (!bot) return;
  bot.on("exit", (code) => {
    if (shuttingDown) return;
    console.error(`[railway] bot exit ${code ?? "?"} — restarting bot`);
    setTimeout(() => {
      if (shuttingDown || children.has("bot")) return;
      startBot();
      watchBot();
    }, 2000);
  });
}

async function main() {
  const needTunnel = NEED_WEB || NEED_BOT;

  function startComfyWatchdog() {
    // Keep port forward alive during tunnel/ssh hiccups.
    if (process.env.COMFY_FORCE_MOCK === "1") return;
    if (process.env.PEACH_USE_COMFY === "0") return;
    if (!process.env.METALNODE_SSH_KEY?.trim()) return;
    try {
      console.log("[railway] starting comfy watchdog…");
      const child = spawn(process.execPath, ["scripts/comfy-tunnel-watchdog.mjs"], {
        cwd: process.cwd(),
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      });
      child.unref();
    } catch {
      /* ignore */
    }
  }

  function scheduleGpuRetry() {
    const retryMs = 30_000;
    const tick = async () => {
      if (shuttingDown) return;
      try {
        const again = await ensureComfyTunnel();
        if (again.ok) {
          console.log(`[railway] GPU Comfy recovered (${again.reason})`);
          return;
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
    try {
      const tunnel = await ensureComfyTunnel();
      if (tunnel.ok) {
        console.log(`[railway] GPU Comfy ready (${tunnel.reason})`);
      } else {
        console.log(`[railway] running without GPU tunnel (${tunnel.reason})`);
        scheduleGpuRetry();
      }

      startComfyWatchdog();
    } catch (err) {
      // Never take down web/bot because Metalnode SSH blips — retry in background.
      console.error(
        "[railway] GPU tunnel failed (continuing without GPU):",
        err instanceof Error ? err.message : err,
      );
      scheduleGpuRetry();

      startComfyWatchdog();
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
