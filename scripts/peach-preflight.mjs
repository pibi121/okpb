/**
 * Full preflight for "ТЕСТ": kill any stale/duplicate SSH tunnels (root cause
 * of flapping Comfy/Ollama), bring up a single clean tunnel + remote services
 * + Next.js, then verify stability over a real window (not just one ping)
 * before declaring ready. Exits 0 only when comfy+ollama+app are all healthy
 * AND stayed healthy through the whole check.
 *
 *   node scripts/peach-preflight.mjs
 */
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { spawn, spawnSync, execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const LOG_DIR = path.join(ROOT, "data", "logs");
fs.mkdirSync(LOG_DIR, { recursive: true });

function loadCfg() {
  return JSON.parse(
    fs.readFileSync(path.join(ROOT, "infra", "metalnode.local.json"), "utf8"),
  );
}

function ping(url, timeoutMs = 4000) {
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

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Kill EVERY ssh.exe / metalnode-tunnel process — no exceptions. This is the
 * fix for the recurring bug: duplicate tunnels fight over local ports and the
 * remote sshd kills both, causing "Comfy недоступен" mid-generation. */
function killAllTunnels(host) {
  if (process.platform !== "win32") return;
  const psPath = path.join(LOG_DIR, "_kill_tunnels.ps1");
  fs.writeFileSync(
    psPath,
    `
Get-CimInstance Win32_Process | Where-Object {
  $_.CommandLine -match 'metalnode-tunnel' -or
  ($_.Name -eq 'ssh.exe' -and $_.CommandLine -match [regex]::Escape('${host}'))
} | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -EA SilentlyContinue }
foreach ($p in 8188,11434) {
  Get-NetTCPConnection -LocalPort $p -State Listen -EA SilentlyContinue |
    ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -EA SilentlyContinue }
}
`,
    "utf8",
  );
  spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", psPath], {
    windowsHide: true,
  });
  try {
    fs.unlinkSync(psPath);
  } catch {
    /* ignore */
  }
  try {
    fs.unlinkSync(path.join(LOG_DIR, "tunnel.pid"));
  } catch {
    /* ignore */
  }
}

function countTunnels(host) {
  if (process.platform !== "win32") return -1;
  const psPath = path.join(LOG_DIR, "_count_tunnels.ps1");
  fs.writeFileSync(
    psPath,
    `(Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'ssh.exe' -and $_.CommandLine -match [regex]::Escape('${host}') } | Measure-Object).Count`,
    "utf8",
  );
  const r = spawnSync(
    "powershell",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", psPath],
    { encoding: "utf8", windowsHide: true },
  );
  try {
    fs.unlinkSync(psPath);
  } catch {
    /* ignore */
  }
  return Number((r.stdout || "0").trim()) || 0;
}

function sshRun(cfg, remoteCmd, timeoutMs = 180_000) {
  const r = spawnSync(
    "ssh.exe",
    [
      "-i",
      cfg.sshKeyPath,
      "-p",
      String(cfg.sshPort),
      "-o",
      "BatchMode=yes",
      "-o",
      "ConnectTimeout=45",
      "-o",
      "StrictHostKeyChecking=accept-new",
      `${cfg.sshUser}@${cfg.host}`,
      remoteCmd,
    ],
    { encoding: "utf8", timeout: timeoutMs, windowsHide: true },
  );
  return { code: r.status ?? 1, stdout: r.stdout || "", stderr: r.stderr || "" };
}

function ensureRemote(cfg) {
  console.log("[preflight] ensuring remote Comfy + Ollama…");
  const remote = `
set +e
mkdir -p /work/logs /work/bin
if ! curl -sf -m 3 http://127.0.0.1:8188/system_stats >/dev/null 2>&1; then
  pkill -f 'python main.py --listen' 2>/dev/null || true
  sleep 2
  cd /work/ComfyUI
  nohup /work/ai/venv/bin/python main.py --listen --port 8188 --enable-manager >> /work/ComfyUI/user/comfyui_8188.log 2>&1 &
  for i in $(seq 1 45); do
    curl -sf -m 2 http://127.0.0.1:8188/system_stats >/dev/null 2>&1 && break
    sleep 2
  done
fi
export OLLAMA_HOST=127.0.0.1:11434
if ! curl -sf -m 3 http://127.0.0.1:11434/api/tags >/dev/null 2>&1; then
  pkill -x ollama 2>/dev/null || true
  sleep 2
  if [ -x /work/bin/start-ollama.sh ]; then
    nohup bash /work/bin/start-ollama.sh >/work/logs/ollama.log 2>&1 &
  elif command -v ollama >/dev/null 2>&1; then
    nohup env OLLAMA_HOST=127.0.0.1:11434 ollama serve >/work/logs/ollama.log 2>&1 &
  fi
  for i in $(seq 1 40); do
    curl -sf -m 2 http://127.0.0.1:11434/api/tags >/dev/null 2>&1 && break
    sleep 2
  done
fi
cat > /work/bin/peach_watch_ollama.sh <<'WATCH'
#!/bin/bash
export OLLAMA_HOST=127.0.0.1:11434
while true; do
  if ! curl -sf -m 3 http://127.0.0.1:11434/api/tags >/dev/null 2>&1; then
    pkill -x ollama 2>/dev/null || true
    sleep 2
    if [ -x /work/bin/start-ollama.sh ]; then
      nohup bash /work/bin/start-ollama.sh >> /work/logs/ollama.log 2>&1 &
    else
      nohup env OLLAMA_HOST=127.0.0.1:11434 ollama serve >> /work/logs/ollama.log 2>&1 &
    fi
  fi
  sleep 20
done
WATCH
chmod +x /work/bin/peach_watch_ollama.sh
pgrep -f 'peach_watch_ollama.sh' >/dev/null 2>&1 || nohup bash /work/bin/peach_watch_ollama.sh >/work/logs/ollama_watch.nohup 2>&1 &
curl -sf -m 5 http://127.0.0.1:8188/system_stats >/dev/null && echo REMOTE_COMFY_OK || echo REMOTE_COMFY_FAIL
curl -sf -m 5 http://127.0.0.1:11434/api/tags >/dev/null && echo REMOTE_OLLAMA_OK || echo REMOTE_OLLAMA_FAIL
`;
  const r = sshRun(cfg, remote);
  if (!r.stdout.includes("REMOTE_COMFY_OK")) {
    throw new Error(`remote Comfy not healthy: ${r.stdout}\n${r.stderr.slice(-300)}`);
  }
  if (!r.stdout.includes("REMOTE_OLLAMA_OK")) {
    throw new Error(`remote Ollama not healthy: ${r.stdout}\n${r.stderr.slice(-300)}`);
  }
  console.log("[preflight] remote Comfy + Ollama OK");
}

function startDetached(cmd, args, logName) {
  const logPath = path.join(LOG_DIR, logName);
  const out = fs.openSync(logPath, "a");
  const child = spawn(cmd, args, {
    cwd: ROOT,
    detached: true,
    stdio: ["ignore", out, out],
    windowsHide: true,
    env: process.env,
    shell: false,
  });
  child.unref();
  return child.pid;
}

async function waitUrl(url, timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (await ping(url)) return true;
    await sleep(1000);
  }
  return false;
}

/** Ping N times over a real window — catches the flapping-tunnel bug that a
 * single ping always misses. */
async function checkStable(url, rounds = 8, intervalMs = 3000) {
  let ok = 0;
  for (let i = 0; i < rounds; i++) {
    if (await ping(url)) ok++;
    else console.warn(`[preflight] ping ${i + 1}/${rounds} failed: ${url}`);
    await sleep(intervalMs);
  }
  // Tolerate one isolated blip (real internet SSH tunnels do that) but not
  // sustained flapping — that's the actual bug we're guarding against.
  return ok >= rounds - 1;
}

async function ollamaChatOnce() {
  const body = JSON.stringify({
    model: "gemma4-heretic",
    stream: false,
    think: false,
    messages: [{ role: "user", content: "Say OK" }],
    options: { num_predict: 8 },
  });
  const res = await new Promise((resolve, reject) => {
    const req = http.request(
      "http://127.0.0.1:11434/api/chat",
      { method: "POST", headers: { "Content-Type": "application/json" }, timeout: 60_000 },
      (r) => {
        let data = "";
        r.on("data", (c) => (data += c));
        r.on("end", () => resolve({ status: r.statusCode, body: data }));
      },
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("timeout"));
    });
    req.write(body);
    req.end();
  });
  if (res.status !== 200) return false;
  const json = JSON.parse(res.body);
  return !!json.message?.content;
}

/** SSH tunnels blip occasionally even when healthy — retry a few times
 * before treating it as a real failure. */
async function ollamaChatWorks(attempts = 4) {
  for (let i = 0; i < attempts; i++) {
    try {
      if (await ollamaChatOnce()) return true;
    } catch (e) {
      console.warn(`[preflight] chat attempt ${i + 1}/${attempts} failed:`, e.message || e);
    }
    await sleep(2000);
  }
  return false;
}

async function main() {
  const cfg = loadCfg();
  if (!fs.existsSync(cfg.sshKeyPath)) {
    console.error(`[preflight] SSH key missing: ${cfg.sshKeyPath}`);
    process.exit(1);
  }

  console.log("[preflight] killing any stale/duplicate tunnels…");
  killAllTunnels(cfg.host);
  await sleep(1500);

  ensureRemote(cfg);

  console.log("[preflight] starting single clean tunnel (paramiko)…");
  startDetached(
    process.execPath,
    [path.join(ROOT, "scripts", "start-comfy-tunnel-detached.mjs")],
    "tunnel.log",
  );

  const comfyUp = await waitUrl("http://127.0.0.1:8188/system_stats", 60_000);
  const ollamaUp = await waitUrl("http://127.0.0.1:11434/api/tags", 30_000);
  if (!comfyUp) {
    console.error("[preflight] FAILED: Comfy tunnel did not come up");
    process.exit(1);
  }
  if (!ollamaUp) {
    console.error("[preflight] FAILED: Ollama tunnel did not come up");
    process.exit(1);
  }

  const tunnelCount = countTunnels(cfg.host);
  if (tunnelCount > 1) {
    console.error(`[preflight] FAILED: ${tunnelCount} duplicate ssh tunnels still running`);
    process.exit(1);
  }

  const nextUp = await ping("http://127.0.0.1:3000/");
  if (!nextUp) {
    console.log("[preflight] starting Next.js…");
    const nextBin = path.join(ROOT, "node_modules", "next", "dist", "bin", "next");
    startDetached(process.execPath, [nextBin, "dev", "-p", "3000"], "next-dev.log");
    const ok = await waitUrl("http://127.0.0.1:3000/", 90_000);
    if (!ok) {
      console.error("[preflight] FAILED: Next.js did not come up");
      process.exit(1);
    }
  } else {
    console.log("[preflight] Next.js already up");
  }

  console.log("[preflight] verifying stability (~20s window)…");
  const [comfyStable, ollamaStable, appStable] = await Promise.all([
    checkStable("http://127.0.0.1:8188/system_stats"),
    checkStable("http://127.0.0.1:11434/api/tags"),
    checkStable("http://127.0.0.1:3000/"),
  ]);

  if (!comfyStable || !ollamaStable || !appStable) {
    console.error(
      `[preflight] FAILED: unstable — comfy=${comfyStable} ollama=${ollamaStable} app=${appStable}`,
    );
    process.exit(1);
  }

  console.log("[preflight] verifying real Ollama chat completion…");
  const chatOk = await ollamaChatWorks();
  if (!chatOk) {
    console.error("[preflight] FAILED: Ollama /api/chat did not respond");
    process.exit(1);
  }

  console.log("");
  console.log("READY — comfy + ollama + app all stable, LLM chat verified.");
  process.exit(0);
}

main().catch((e) => {
  console.error("[preflight]", e.message || e);
  process.exit(1);
});
