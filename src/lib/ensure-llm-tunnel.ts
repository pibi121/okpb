/**
 * If local Ollama tunnel (:11435) is down, spawn metalnode-llm-tunnel.mjs
 * (auto-reconnect loop) and wait until /api/tags answers.
 */
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import http from "node:http";
import { loadMetalnodeConfig } from "@/lib/metalnode-config";

let spawnInFlight: Promise<boolean> | null = null;
let lastSpawnAt = 0;

function llmLocalUrl(): string {
  const cfg = loadMetalnodeConfig();
  return (
    process.env.OLLAMA_URL ||
    cfg.llmOllamaUrl ||
    "http://127.0.0.1:11435"
  ).replace(/\/$/, "");
}

function pingTags(timeoutMs = 2500): Promise<boolean> {
  const url = `${llmLocalUrl()}/api/tags`;
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

function projectRoot(): string {
  return process.cwd();
}

function spawnLlmTunnelKeeper(): void {
  const root = projectRoot();
  const script = path.join(root, "scripts", "metalnode-llm-tunnel.mjs");
  if (!fs.existsSync(script)) {
    console.warn("[peach] ensure-llm-tunnel: missing", script);
    return;
  }
  const logDir = path.join(root, "data", "logs");
  fs.mkdirSync(logDir, { recursive: true });
  const logPath = path.join(logDir, "llm-tunnel.log");
  const out = fs.openSync(logPath, "a");
  const child = spawn(process.execPath, [script], {
    cwd: root,
    detached: true,
    stdio: ["ignore", out, out],
    windowsHide: true,
    env: process.env,
  });
  child.unref();
  lastSpawnAt = Date.now();
  console.warn(`[peach] ensure-llm-tunnel: spawned pid=${child.pid} log=${logPath}`);
}

/**
 * Returns true when Ollama answers locally. Spawns the LLM SSH tunnel if needed.
 */
export async function ensureLlmTunnel(opts?: {
  waitMs?: number;
}): Promise<boolean> {
  if (await pingTags()) return true;

  if (spawnInFlight) return spawnInFlight;

  spawnInFlight = (async () => {
    try {
      // Avoid thrashing if multiple requests fail at once
      if (Date.now() - lastSpawnAt > 8_000) {
        spawnLlmTunnelKeeper();
      }
      const deadline = Date.now() + (opts?.waitMs ?? 90_000);
      while (Date.now() < deadline) {
        if (await pingTags(3000)) return true;
        await new Promise((r) => setTimeout(r, 1500));
      }
      return false;
    } finally {
      spawnInFlight = null;
    }
  })();

  return spawnInFlight;
}
