/**
 * SSH tunnel for LLM-only Metalnode: remote Ollama :11434 → local :11435
 * Does not touch the GPU Comfy tunnel (:8188 / other SSH port).
 */
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import http from "node:http";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const KEEP = "while true; do echo k; sleep 2; done";
const LOCAL_PORT = 11435;

function loadLlmCfg() {
  const p = path.join(ROOT, "infra", "metalnode.llm.json");
  if (!fs.existsSync(p)) {
    throw new Error(`Missing ${p}`);
  }
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function ping(url, timeoutMs = 2500) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
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

function killStale(host, sshPort) {
  if (process.platform !== "win32") return;
  const ps = `
Get-CimInstance Win32_Process -Filter "Name='ssh.exe'" |
  Where-Object {
    $_.CommandLine -match [regex]::Escape('${host}') -and
    $_.CommandLine -match ('-p\\s+' + [regex]::Escape('${sshPort}'))
  } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -EA SilentlyContinue }
Get-NetTCPConnection -LocalPort ${LOCAL_PORT} -State Listen -EA SilentlyContinue |
  ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -EA SilentlyContinue }
`;
  spawnSync("powershell", ["-NoProfile", "-Command", ps], { windowsHide: true });
}

function sshArgs(cfg) {
  const key = cfg.llmSshKeyPath;
  const port = cfg.llmSshPort;
  const host = cfg.llmHost;
  const user = cfg.llmSshUser || "root";
  return [
    "-i",
    key,
    "-o",
    "BatchMode=yes",
    "-o",
    "ServerAliveInterval=15",
    "-o",
    "ServerAliveCountMax=6",
    "-o",
    "TCPKeepAlive=yes",
    "-o",
    "StrictHostKeyChecking=accept-new",
    "-o",
    "AddressFamily=inet",
    "-L",
    `${LOCAL_PORT}:127.0.0.1:${cfg.llmRemoteOllamaPort || 11434}`,
    "-p",
    String(port),
    `${user}@${host}`,
    KEEP,
  ];
}

function runOnce(cfg) {
  return new Promise((resolve) => {
    console.log(`[llm-tunnel] ${cfg.llmHost}:${cfg.llmSshPort} → localhost:${LOCAL_PORT}`);
    const child = spawn("ssh.exe", sshArgs(cfg), {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    if (child.stdout) child.stdout.resume();
    if (child.stderr) {
      child.stderr.on("data", (buf) => {
        const s = buf.toString("utf8");
        if (s.trim()) process.stderr.write(s);
      });
    }
    child.on("exit", (code) => resolve(code ?? 1));
    child.on("error", (e) => {
      console.error("[llm-tunnel] spawn", e.message);
      resolve(1);
    });
  });
}

async function main() {
  const cfg = loadLlmCfg();
  if (!fs.existsSync(cfg.llmSshKeyPath)) {
    throw new Error(`LLM key not found: ${cfg.llmSshKeyPath}`);
  }
  killStale(cfg.llmHost, cfg.llmSshPort);
  for (;;) {
    killStale(cfg.llmHost, cfg.llmSshPort);
    await new Promise((r) => setTimeout(r, 400));
    const code = await runOnce(cfg);
    const up = await ping(`http://127.0.0.1:${LOCAL_PORT}/api/tags`);
    console.warn(`[llm-tunnel] exited ${code} ollama=${up}, reconnect in 5s…`);
    await new Promise((r) => setTimeout(r, 5000));
  }
}

main().catch((e) => {
  console.error("[llm-tunnel]", e.message || e);
  process.exit(1);
});
