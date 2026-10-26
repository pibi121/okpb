/**
 * Materialize fleet SSH keys and keep Paramiko forwards for extra GPUs.
 * Started by comfy-tunnel-watchdog alongside primary :8188 tunnel.
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = path.join(ROOT, "scripts", "paramiko-fleet-tunnels.py");

const FLEET = [
  {
    name: "bmserv4",
    localPort: 8189,
    sshPort: 22031,
    keyEnv: "METALNODE_SSH_KEY_BMSERV4",
    keyPath: "/tmp/metalnode_key_bmserv4",
  },
  {
    name: "bmserv1",
    localPort: 8190,
    sshPort: 22022,
    keyEnv: "METALNODE_SSH_KEY_BMSERV1",
    keyPath: "/tmp/metalnode_key_bmserv1",
  },
  {
    name: "gpu2",
    localPort: 8192,
    sshPort: 22026,
    keyEnv: "METALNODE_SSH_KEY_GPU2",
    keyPath: "/tmp/metalnode_key_gpu2",
  },
  {
    name: "ownerlab",
    localPort: 8191,
    sshPort: 22026,
    keyEnv: "METALNODE_SSH_KEY_OWNERLAB",
    keyPath: "/tmp/metalnode_key_ownerlab",
  },
  {
    name: "poselab",
    localPort: 8193,
    sshPort: 22034,
    keyEnv: "METALNODE_SSH_KEY_POSELAB",
    keyPath: "/tmp/metalnode_key_poselab",
  },
];

/** @type {import("node:child_process").ChildProcess | null} */
let fleetProc = null;
/** @type {Promise<any> | null} */
let ensureFlight = null;
let lastSpawnAt = 0;
/** Don't kill/respawn a live fleet process: that loop exhausted threads and killed the bot. */
const RESPAWN_COOLDOWN_MS = 3 * 60 * 1000;

function log(msg) {
  console.log(`[fleet-tunnel] ${msg}`);
}

function writeKey(envName, keyPath) {
  const raw = process.env[envName]?.trim();
  if (!raw) return false;
  const key = raw.includes("\\n") ? raw.replace(/\\n/g, "\n") : raw;
  fs.mkdirSync(path.dirname(keyPath), { recursive: true });
  fs.writeFileSync(keyPath, key.endsWith("\n") ? key : `${key}\n`, {
    mode: 0o600,
  });
  return true;
}

export function materializeFleetKeys() {
  const ok = [];
  for (const g of FLEET) {
    if (writeKey(g.keyEnv, g.keyPath)) ok.push(g.name);
  }
  return ok;
}

function pingPort(port, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const req = http.get(
      `http://127.0.0.1:${port}/system_stats`,
      { timeout: timeoutMs },
      (res) => {
        res.resume();
        resolve((res.statusCode || 0) >= 200 && (res.statusCode || 0) < 500);
      },
    );
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
}

export async function pingFleetComfy() {
  const out = {};
  for (const g of FLEET) {
    out[g.name] = await pingPort(g.localPort);
  }
  return out;
}

function pythonBin() {
  for (const bin of [process.env.PEACH_PYTHON, "python3", "python"].filter(Boolean)) {
    const r = spawnSync(bin, ["-c", "import paramiko"], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 8000,
    });
    if (!r.error && r.status === 0) return bin;
  }
  return null;
}

export function fleetTunnelAlive() {
  return Boolean(fleetProc && !fleetProc.killed && fleetProc.exitCode == null);
}

export async function ensureFleetTunnels() {
  if (ensureFlight) return ensureFlight;
  ensureFlight = ensureFleetTunnelsInner().finally(() => {
    ensureFlight = null;
  });
  return ensureFlight;
}

async function ensureFleetTunnelsInner() {
  const ready = materializeFleetKeys();
  if (!ready.length) {
    log("no fleet SSH keys — skip fleet tunnels");
    return { ok: false, reason: "no_keys" };
  }

  const pings = await pingFleetComfy();
  if (ready.every((n) => pings[n])) {
    return { ok: true, reason: "already_up", ready, pings };
  }

  // Spare GPUs reconnect inside the python process. Replacing it every
  // watchdog tick piled up SSH threads until the Telegram poller aborted.
  if (fleetTunnelAlive()) {
    return {
      ok: Object.values(pings).some(Boolean),
      reason: "partial",
      ready,
      pings,
    };
  }

  if (Date.now() - lastSpawnAt < RESPAWN_COOLDOWN_MS) {
    return { ok: false, reason: "cooldown", ready, pings };
  }

  const py = pythonBin();
  if (!py) {
    log("paramiko/python missing — cannot start fleet tunnels");
    return { ok: false, reason: "no_python" };
  }

  lastSpawnAt = Date.now();

  const host = process.env.METALNODE_HOST || "77.94.203.13";
  const fleetJson = JSON.stringify(
    FLEET.filter((g) => fs.existsSync(g.keyPath)).map((g) => ({
      name: g.name,
      localPort: g.localPort,
      sshPort: g.sshPort,
      keyPath: g.keyPath,
      host,
      sshUser: process.env.METALNODE_SSH_USER || "root",
    })),
  );

  log(`starting fleet tunnels (${ready.join(", ")}) via ${py}`);
  fleetProc = spawn(py, [SCRIPT], {
    cwd: ROOT,
    stdio: "inherit",
    windowsHide: true,
    env: {
      ...process.env,
      METALNODE_HOST: host,
      METALNODE_FLEET_JSON: fleetJson,
    },
  });
  fleetProc.on("exit", (code) => {
    log(`fleet process exit ${code}`);
    fleetProc = null;
  });

  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const p = await pingFleetComfy();
    if (ready.every((n) => p[n])) {
      log(`FLEET_OK ${ready.join(",")}`);
      return { ok: true, reason: "tunnel", ready, pings: p };
    }
    if (!fleetTunnelAlive()) break;
  }
  const p = await pingFleetComfy();
  log(`fleet partial: ${JSON.stringify(p)}`);
  return { ok: Object.values(p).some(Boolean), reason: "partial", ready, pings: p };
}

export function stopFleetTunnels() {
  if (fleetProc && !fleetProc.killed) {
    try {
      fleetProc.kill("SIGTERM");
    } catch {
      /* ignore */
    }
  }
  fleetProc = null;
}
