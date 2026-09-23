/**
 * Keep Comfy :8188 alive. Owns the SSH/Paramiko tunnel in THIS process
 * (start-railway starts this as a managed child — not detached).
 *
 *   node scripts/comfy-tunnel-watchdog.mjs
 *
 * Env:
 *   PEACH_TUNNEL_TICK_MS     default 20000
 *   PEACH_TUNNEL_FAILS       fails before restart (default 2)
 *   PEACH_TUNNEL_ESCALATE_MS continuous down before escalate (default 180000)
 */
import http from "node:http";
import fs from "node:fs";
import {
  ensureComfyTunnel,
  forceRestartComfyTunnel,
  readTunnelStatus,
} from "./railway-comfy-tunnel.mjs";
import { ensureFleetTunnels, pingFleetComfy } from "./railway-fleet-tunnels.mjs";

const TICK_MS = Math.max(
  8_000,
  Number(process.env.PEACH_TUNNEL_TICK_MS || 20_000) || 20_000,
);
const FAIL_BEFORE_RESTART = Math.max(
  1,
  Number(process.env.PEACH_TUNNEL_FAILS || 2) || 2,
);
const ESCALATE_AFTER_MS = Math.max(
  60_000,
  Number(process.env.PEACH_TUNNEL_ESCALATE_MS || 180_000) || 180_000,
);
const STATUS_PATH =
  process.env.PEACH_TUNNEL_STATUS_PATH || "/tmp/peach-tunnel-status.json";
const COMFY_BASE = (
  process.env.COMFY_URL || "http://127.0.0.1:8188"
).replace(/\/$/, "");

let fails = 0;
let downSince = 0;
let restartInFlight = false;
let lastRestartAt = 0;
let lastEscalateAt = 0;

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

function patchStatus(patch) {
  try {
    let prev = {};
    if (fs.existsSync(STATUS_PATH)) {
      try {
        prev = JSON.parse(fs.readFileSync(STATUS_PATH, "utf8"));
      } catch {
        prev = {};
      }
    }
    fs.writeFileSync(
      STATUS_PATH,
      JSON.stringify(
        { ...prev, ...patch, updatedAt: new Date().toISOString() },
        null,
        2,
      ),
    );
  } catch {
    /* ignore */
  }
}

async function restartTunnel(force) {
  if (restartInFlight) return;
  const sinceLast = Date.now() - lastRestartAt;
  // When SSH is wedged (MaxStartups), frequent forceRestart makes it worse.
  const cooldown = force ? 90_000 : 45_000;
  if (sinceLast < cooldown) {
    console.log(
      `[watchdog] skip restart (cooldown ${Math.round((cooldown - sinceLast) / 1000)}s)`,
    );
    return;
  }
  restartInFlight = true;
  lastRestartAt = Date.now();
  console.log(
    `[watchdog] ${new Date().toISOString()} comfy down → ${force ? "forceRestart" : "ensure"}`,
  );
  try {
    const r = force
      ? await forceRestartComfyTunnel()
      : await ensureComfyTunnel();
    console.log(`[watchdog] tunnel result: ${r.reason} ok=${r.ok}`);
    if (r.ok) {
      downSince = 0;
      fails = 0;
      patchStatus({
        ok: true,
        escalate: false,
        reason: r.reason,
        error: "",
        healer: "watchdog",
      });
    } else {
      patchStatus({
        ok: false,
        reason: r.reason,
        error: (readTunnelStatus()?.error || r.reason || "").slice(0, 240),
        healer: "watchdog",
      });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[watchdog] tunnel restart failed:`, msg);
    patchStatus({
      ok: false,
      reason: "restart_error",
      error: msg.slice(0, 240),
      escalate: /EAGAIN|can't start new thread|Resource temporarily unavailable/i.test(
        msg,
      ),
      healer: "watchdog",
    });
  } finally {
    restartInFlight = false;
  }
}

async function boot() {
  console.log(
    `[watchdog] started tick=${TICK_MS}ms fails=${FAIL_BEFORE_RESTART} escalateAfter=${ESCALATE_AFTER_MS}ms`,
  );
  try {
    const r = await ensureComfyTunnel();
    console.log(`[watchdog] boot tunnel: ${r.reason} ok=${r.ok}`);
    patchStatus({
      ok: r.ok,
      escalate: false,
      reason: r.reason,
      error: r.ok ? "" : (readTunnelStatus()?.error || r.reason || ""),
      healer: "watchdog",
    });
    if (!r.ok) downSince = Date.now();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[watchdog] boot failed:`, msg);
    downSince = Date.now();
    patchStatus({
      ok: false,
      reason: "boot_error",
      error: msg.slice(0, 240),
      healer: "watchdog",
    });
  }

  try {
    const fleet = await ensureFleetTunnels();
    console.log(
      `[watchdog] fleet tunnels: ${fleet.reason} ok=${fleet.ok} ready=${(fleet.ready || []).join(",")}`,
    );
    patchStatus({ fleet: fleet.pings || (await pingFleetComfy()) });
  } catch (e) {
    console.error(
      `[watchdog] fleet boot failed:`,
      e instanceof Error ? e.message : e,
    );
  }

  setInterval(() => {
    void (async () => {
      const ok = await pingComfy();
      if (ok) {
        if (fails > 0 || downSince) {
          console.log(`[watchdog] ${new Date().toISOString()} comfy OK again`);
        }
        fails = 0;
        downSince = 0;
        patchStatus({
          ok: true,
          escalate: false,
          reason: "ping_ok",
          error: "",
          healer: "watchdog",
        });
        // Keep extra GPUs warm without restarting primary.
        void ensureFleetTunnels().then(async (f) => {
          if (f.ok) patchStatus({ fleet: f.pings || (await pingFleetComfy()) });
        });
        return;
      }

      fails += 1;
      if (!downSince) downSince = Date.now();
      const downFor = Date.now() - downSince;
      console.log(
        `[watchdog] ${new Date().toISOString()} comfy ping fail (${fails}) downFor=${Math.round(downFor / 1000)}s`,
      );

      if (fails >= FAIL_BEFORE_RESTART) {
        await restartTunnel(downFor > 45_000 || fails >= FAIL_BEFORE_RESTART + 1);
        fails = 0;
      }

      if (downFor >= ESCALATE_AFTER_MS && Date.now() - lastEscalateAt > 30 * 60_000) {
        lastEscalateAt = Date.now();
        console.error(
          `[watchdog] ESCALATE: Comfy down ${Math.round(downFor / 1000)}s — container/GPU may need restart`,
        );
        patchStatus({
          ok: false,
          escalate: true,
          reason: "escalate",
          error: `Metalnode SSH/Comfy unreachable ${Math.round(downFor / 60_000)}m — reboot GPU host via panel`,
          healer: "watchdog",
        });
      }
    })();
  }, TICK_MS);
}

void boot();
