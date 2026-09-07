/**
 * SSH / Paramiko tunnel to Metalnode Comfy for Railway production.
 * Forwards localhost:8188 → GPU Comfy.
 *
 * Env:
 *   METALNODE_SSH_KEY   — private key (multiline or \n escaped)
 *   METALNODE_HOST      — required (GPU SSH host)
 *   METALNODE_SSH_PORT  — default 22031
 *   METALNODE_SSH_USER  — default root
 *   COMFY_URL           — default http://127.0.0.1:8188
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const KEY_PATH = process.env.METALNODE_SSH_KEY_PATH || "/tmp/metalnode_ssh_key";
const HOST = process.env.METALNODE_HOST?.trim() || "";
const SSH_PORT = String(process.env.METALNODE_SSH_PORT || "22031");
const SSH_USER = process.env.METALNODE_SSH_USER || "root";
const LOCAL_PORT = String(process.env.COMFY_LOCAL_PORT || "8188");
const COMFY_BASE = (process.env.COMFY_URL || `http://127.0.0.1:${LOCAL_PORT}`).replace(
  /\/$/,
  "",
);
const KEEPALIVE = "while true; do echo k; sleep 2; done";
const PARAMIKO_SCRIPT = path.join(ROOT, "scripts", "paramiko-comfy-tunnel.py");
const STATUS_PATH =
  process.env.PEACH_TUNNEL_STATUS_PATH || "/tmp/peach-tunnel-status.json";

/** @type {import("node:child_process").ChildProcess | null} */
let tunnelProc = null;
let lastTunnelError = "";

function writeTunnelStatus(patch) {
  try {
    let prev = {};
    if (fs.existsSync(STATUS_PATH)) {
      try {
        prev = JSON.parse(fs.readFileSync(STATUS_PATH, "utf8"));
      } catch {
        prev = {};
      }
    }
    const next = {
      ...prev,
      ...patch,
      updatedAt: new Date().toISOString(),
      host: HOST,
      sshPort: SSH_PORT,
      comfyUrl: COMFY_BASE,
    };
    fs.writeFileSync(STATUS_PATH, JSON.stringify(next, null, 2));
  } catch {
    /* ignore */
  }
}

export function readTunnelStatus() {
  try {
    if (!fs.existsSync(STATUS_PATH)) return null;
    return JSON.parse(fs.readFileSync(STATUS_PATH, "utf8"));
  } catch {
    return null;
  }
}

function classifyTunnelError(raw) {
  const s = String(raw || "");
  if (/Permission denied \(publickey\)/i.test(s)) {
    return "SSH: Permission denied (publickey) — update METALNODE_SSH_KEY or Metalnode authorized_keys";
  }
  if (/Connection refused|Connection timed out|timed out/i.test(s)) {
    return "SSH: host unreachable (network / port / node powered off)";
  }
  if (/Could not resolve hostname/i.test(s)) {
    return "SSH: cannot resolve METALNODE_HOST";
  }
  return s.slice(0, 240) || "tunnel error";
}

function log(msg) {
  console.log(`[railway-tunnel] ${msg}`);
}

function gpuModeEnabled() {
  return process.env.COMFY_FORCE_MOCK !== "1" && process.env.PEACH_USE_COMFY !== "0";
}

function pingComfy(timeoutMs = 4000) {
  return new Promise((resolve) => {
    const req = http.get(`${COMFY_BASE}/system_stats`, { timeout: timeoutMs }, (res) => {
      res.resume();
      resolve(res.statusCode >= 200 && res.statusCode < 500);
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
}

function writeKey(raw) {
  const key = raw.includes("\\n") ? raw.replace(/\\n/g, "\n") : raw;
  fs.writeFileSync(KEY_PATH, key.endsWith("\n") ? key : `${key}\n`, { mode: 0o600 });
  process.env.METALNODE_SSH_KEY_PATH = KEY_PATH;
}

function findPython() {
  for (const name of ["python3", "python"]) {
    const r = spawnSync(name, ["-c", "import paramiko"], {
      encoding: "utf8",
      windowsHide: true,
    });
    if (r.status === 0) return name;
  }
  // Try install paramiko into user site if python exists without the package.
  for (const name of ["python3", "python"]) {
    const hasPy = spawnSync(name, ["-V"], { encoding: "utf8", windowsHide: true });
    if (hasPy.status !== 0) continue;
    log(`installing paramiko via ${name} -m pip…`);
    const pip = spawnSync(
      name,
      ["-m", "pip", "install", "--user", "-q", "paramiko"],
      { encoding: "utf8", windowsHide: true, timeout: 120_000 },
    );
    if (pip.status === 0) {
      const check = spawnSync(name, ["-c", "import paramiko"], {
        encoding: "utf8",
        windowsHide: true,
      });
      if (check.status === 0) return name;
    } else {
      log(`pip install failed: ${(pip.stderr || pip.stdout || "").slice(0, 240)}`);
    }
  }
  return null;
}

function findSsh() {
  for (const name of ["ssh", "/usr/bin/ssh", "/bin/ssh"]) {
    const r = spawnSync(name, ["-V"], { encoding: "utf8", windowsHide: true });
    // ssh -V writes to stderr; status may be 0
    if (r.status === 0 || /OpenSSH/i.test(String(r.stderr || r.stdout || ""))) {
      return name;
    }
  }
  return null;
}

function attachTunnelHandlers(proc, label) {
  proc.stdout?.on("data", () => {});
  proc.stderr?.on("data", (buf) => {
    const line = String(buf).trim();
    if (line) {
      log(`${label}: ${line}`);
      lastTunnelError = classifyTunnelError(line);
      writeTunnelStatus({
        ok: false,
        reason: "tunnel_stderr",
        error: lastTunnelError,
        raw: line.slice(0, 400),
      });
    }
  });
  proc.on("error", (err) => {
    const msg = err instanceof Error ? err.message : String(err);
    log(`${label} spawn error: ${msg}`);
    lastTunnelError = classifyTunnelError(msg);
    writeTunnelStatus({ ok: false, reason: "spawn_error", error: lastTunnelError });
    tunnelProc = null;
  });
  proc.on("exit", (code) => {
    log(`${label} exited ${code ?? "?"}`);
    if (code && code !== 0) {
      writeTunnelStatus({
        ok: false,
        reason: "tunnel_exit",
        error: lastTunnelError || `tunnel exited ${code}`,
        exitCode: code,
      });
    }
    tunnelProc = null;
  });
}

function startTunnel() {
  if (tunnelProc && !tunnelProc.killed && tunnelProc.exitCode == null) {
    return tunnelProc;
  }

  const py = findPython();
  if (py) {
    log(`starting paramiko tunnel (${py})`);
    tunnelProc = spawn(py, [PARAMIKO_SCRIPT], {
      stdio: ["ignore", "pipe", "pipe"],
      detached: false,
      env: {
        ...process.env,
        METALNODE_HOST: HOST,
        METALNODE_SSH_PORT: SSH_PORT,
        METALNODE_SSH_USER: SSH_USER,
        METALNODE_SSH_KEY_PATH: KEY_PATH,
        COMFY_LOCAL_PORT: LOCAL_PORT,
      },
    });
    attachTunnelHandlers(tunnelProc, "paramiko");
    return tunnelProc;
  }

  const sshBin = findSsh();
  if (!sshBin) {
    log("no python/paramiko and no ssh binary — cannot open tunnel");
    return null;
  }

  const args = [
    "-i",
    KEY_PATH,
    "-o",
    "StrictHostKeyChecking=no",
    "-o",
    "UserKnownHostsFile=/dev/null",
    "-o",
    "ServerAliveInterval=15",
    "-o",
    "ServerAliveCountMax=4",
    "-o",
    "ExitOnForwardFailure=yes",
    "-L",
    `127.0.0.1:${LOCAL_PORT}:127.0.0.1:8188`,
    "-p",
    SSH_PORT,
    `${SSH_USER}@${HOST}`,
    KEEPALIVE,
  ];

  log(`starting OpenSSH tunnel (${sshBin})`);
  tunnelProc = spawn(sshBin, args, {
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
  });
  attachTunnelHandlers(tunnelProc, "ssh");
  return tunnelProc;
}

function sshBaseArgs(sshBin) {
  return [
    "-i",
    KEY_PATH,
    "-o",
    "StrictHostKeyChecking=no",
    "-o",
    "UserKnownHostsFile=/dev/null",
    "-o",
    "BatchMode=yes",
    "-o",
    `ConnectTimeout=25`,
    "-p",
    SSH_PORT,
    `${SSH_USER}@${HOST}`,
  ];
}

async function ensureRemoteComfyUp() {
  const sshBin = findSsh();
  if (!sshBin) {
    log("skip remote comfy start — no ssh binary (GPU should already be up)");
    return false;
  }

  const remote = `
set +e
if curl -sf -m 3 http://127.0.0.1:8188/system_stats >/dev/null; then
  echo COMFY_OK
  exit 0
fi

echo COMFY_DOWN — starting
if [ -x /work/bin/start-comfy.sh ]; then
  /work/bin/start-comfy.sh >/tmp/start-comfy.out 2>&1 &
elif [ -f /usr/local/bin/comfy-watchdog.sh ]; then
  bash /usr/local/bin/comfy-watchdog.sh >/tmp/start-comfy.out 2>&1 &
fi

for i in $(seq 1 25); do
  sleep 1
  if curl -sf -m 3 http://127.0.0.1:8188/system_stats >/dev/null; then
    echo COMFY_UP
    exit 0
  fi
done

echo COMFY_FAIL
exit 1
`;

  const r = spawnSync(sshBin, [...sshBaseArgs(sshBin), remote], {
    encoding: "utf8",
    timeout: 120_000,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const out = String(r.stdout || "").trim().split("\n").slice(-5).join(" | ");
  const err = String(r.stderr || "").trim().split("\n").slice(-3).join(" | ");
  if (out) log(`remote comfy: ${out}`);
  if (r.status !== 0 && err) log(`remote comfy err: ${err}`);
  return r.status === 0;
}

export async function ensureComfyTunnel() {
  if (!gpuModeEnabled()) {
    log("GPU disabled (COMFY_FORCE_MOCK or PEACH_USE_COMFY=0) — skip tunnel");
    writeTunnelStatus({ ok: false, reason: "disabled", error: "GPU mode disabled" });
    return { ok: false, reason: "disabled" };
  }

  if (await pingComfy()) {
    log(`Comfy already reachable at ${COMFY_BASE}`);
    writeTunnelStatus({ ok: true, reason: "already_up", error: "" });
    return { ok: true, reason: "already_up" };
  }

  const key = process.env.METALNODE_SSH_KEY?.trim();
  if (!key) {
    writeTunnelStatus({
      ok: false,
      reason: "missing_key",
      error: "METALNODE_SSH_KEY отсутствует в Railway",
    });
    throw new Error(
      "PEACH_USE_COMFY=1 but METALNODE_SSH_KEY is missing — cannot reach GPU Comfy",
    );
  }
  if (!HOST) {
    writeTunnelStatus({
      ok: false,
      reason: "missing_host",
      error: "METALNODE_HOST отсутствует в Railway",
    });
    throw new Error(
      "PEACH_USE_COMFY=1 but METALNODE_HOST is missing — cannot reach GPU Comfy",
    );
  }

  writeKey(key);

  if (!process.env.COMFY_SKIP_REMOTE_START) {
    try {
      await ensureRemoteComfyUp();
    } catch (e) {
      log(
        `remote comfy start failed: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }
  }

  log(`starting tunnel -> ${HOST}:${SSH_PORT} (local :${LOCAL_PORT})`);
  const proc = startTunnel();
  if (!proc) {
    writeTunnelStatus({
      ok: false,
      reason: "no_tunnel_backend",
      error: "нет ssh/paramiko для туннеля",
    });
    return { ok: false, reason: "no_tunnel_backend" };
  }

  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    if (await pingComfy()) {
      log("COMFY_OK");
      writeTunnelStatus({ ok: true, reason: "tunnel", error: "" });
      return { ok: true, reason: "tunnel" };
    }
    if (!tunnelProc || tunnelProc.killed || tunnelProc.exitCode != null) {
      log("tunnel process died early — abort wait");
      break;
    }
  }

  log(`Comfy not reachable at ${COMFY_BASE} after tunnel`);
  const err =
    lastTunnelError ||
    "Comfy недоступен после туннеля (нода выключена или SSH-ключ неверный)";
  writeTunnelStatus({ ok: false, reason: "unreachable", error: err });
  return { ok: false, reason: "unreachable" };
}

export async function pingComfyHealth() {
  const up = await pingComfy(3000);
  return { url: COMFY_BASE, up, gpuMode: gpuModeEnabled() };
}
