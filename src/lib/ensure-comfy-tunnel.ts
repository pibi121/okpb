/**
 * If local Comfy tunnel (:8188) is down, spawn Paramiko tunnel keeper
 * (Windows OpenSSH -L dies; see scripts/paramiko-comfy-tunnel.py).
 */
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import http from "node:http";
import { comfyBaseUrl, loadMetalnodeConfig } from "@/lib/metalnode-config";

let spawnInFlight: Promise<boolean> | null = null;
let lastSpawnAt = 0;

function pingComfy(timeoutMs = 2500): Promise<boolean> {
  const url = `${comfyBaseUrl()}/system_stats`;
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      res.resume();
      resolve((res.statusCode || 0) >= 200 && (res.statusCode || 0) < 500);
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
}

function spawnComfyTunnelKeeper(): void {
  const root = process.cwd();
  const starter = path.join(root, "scripts", "start-comfy-tunnel-detached.mjs");
  const py = path.join(root, "scripts", "paramiko-comfy-tunnel.py");
  if (!fs.existsSync(starter) && !fs.existsSync(py)) {
    console.warn("[peach] ensure-comfy-tunnel: missing paramiko tunnel scripts");
    return;
  }
  const cfg = loadMetalnodeConfig();
  if (!fs.existsSync(cfg.sshKeyPath)) {
    console.warn("[peach] ensure-comfy-tunnel: SSH key missing", cfg.sshKeyPath);
    return;
  }
  const logDir = path.join(root, "data", "logs");
  fs.mkdirSync(logDir, { recursive: true });
  const logPath = path.join(logDir, "ensure-comfy-tunnel.log");
  const out = fs.openSync(logPath, "a");
  // Prefer the detached starter (pings first, does not kill a healthy tunnel).
  const child = fs.existsSync(starter)
    ? spawn(process.execPath, [starter], {
        cwd: root,
        detached: true,
        stdio: ["ignore", out, out],
        windowsHide: true,
        env: process.env,
      })
    : spawn("python", [py], {
        cwd: root,
        detached: true,
        stdio: ["ignore", out, out],
        windowsHide: true,
        env: process.env,
      });
  child.unref();
  lastSpawnAt = Date.now();
  console.warn(
    `[peach] ensure-comfy-tunnel: spawned pid=${child.pid} log=${logPath}`,
  );
}

/** Returns true when Comfy answers on localhost. Spawns SSH tunnel keeper if needed. */
export async function ensureComfyTunnel(opts?: {
  waitMs?: number;
}): Promise<boolean> {
  if (await pingComfy()) return true;

  if (spawnInFlight) return spawnInFlight;

  spawnInFlight = (async () => {
    try {
      if (Date.now() - lastSpawnAt > 8_000) {
        spawnComfyTunnelKeeper();
      }
      const deadline = Date.now() + (opts?.waitMs ?? 90_000);
      while (Date.now() < deadline) {
        if (await pingComfy(4000)) return true;
        await new Promise((r) => setTimeout(r, 1500));
      }
      return false;
    } finally {
      spawnInFlight = null;
    }
  })();

  return spawnInFlight;
}
