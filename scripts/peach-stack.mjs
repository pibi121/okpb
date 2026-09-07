/**
 * One-command Peach stack for local testing:
 *   1) ensure Comfy + Ollama on Metalnode
 *   2) stable SSH tunnel (:8188, :11434) with keepalive
 *   3) Next.js on :3000
 *
 *   npm run stack
 */
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import http from "node:http";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const isWin = process.platform === "win32";

function runSync(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    cwd: ROOT,
    stdio: "inherit",
    windowsHide: true,
    shell: isWin,
    ...opts,
  });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed`);
}

function loadCfg() {
  const p = path.join(ROOT, "infra", "metalnode.local.json");
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function ping(url, timeoutMs = 3000) {
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

function sshRun(cfg, remoteCmd, timeoutMs = 120_000) {
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
  return {
    code: r.status ?? 1,
    stdout: r.stdout || "",
    stderr: r.stderr || "",
  };
}

function ensureRemote(cfg) {
  console.log("[stack] ensure Comfy + Ollama on Metalnode…");
  const remote = `
set +e
mkdir -p /work/logs /work/bin

# --- Comfy ---
if ! curl -sf -m 3 http://127.0.0.1:8188/system_stats >/dev/null 2>&1; then
  echo COMFY_RESTART
  pkill -f 'python main.py --listen' 2>/dev/null || true
  sleep 2
  cd /work/ComfyUI
  nohup /work/ai/venv/bin/python main.py --listen --port 8188 --enable-manager >> /work/ComfyUI/user/comfyui_8188.log 2>&1 &
  for i in $(seq 1 45); do
    curl -sf -m 2 http://127.0.0.1:8188/system_stats >/dev/null 2>&1 && echo COMFY_UP && break
    sleep 2
  done
else
  echo COMFY_OK
fi

# --- Ollama (must listen on 11434) ---
export OLLAMA_HOST=127.0.0.1:11434
if ! curl -sf -m 3 http://127.0.0.1:11434/api/tags >/dev/null 2>&1; then
  echo OLLAMA_RESTART
  pkill -x ollama 2>/dev/null || true
  sleep 2
  mkdir -p /work/logs
  if [ -x /work/bin/start-ollama.sh ]; then
    nohup bash /work/bin/start-ollama.sh >/work/logs/ollama.log 2>&1 &
  elif command -v ollama >/dev/null 2>&1; then
    nohup env OLLAMA_HOST=127.0.0.1:11434 ollama serve >/work/logs/ollama.log 2>&1 &
  fi
  for i in $(seq 1 40); do
    curl -sf -m 2 http://127.0.0.1:11434/api/tags >/dev/null 2>&1 && echo OLLAMA_UP && break
    sleep 2
  done
else
  echo OLLAMA_OK
fi

# lightweight watchdog (idempotent)
cat > /work/bin/peach_watch_ollama.sh <<'WATCH'
#!/bin/bash
export OLLAMA_HOST=127.0.0.1:11434
while true; do
  if ! curl -sf -m 3 http://127.0.0.1:11434/api/tags >/dev/null 2>&1; then
    echo "[$(date -Is)] ollama down — restart" >> /work/logs/ollama_watch.log
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
if ! pgrep -f 'peach_watch_ollama.sh' >/dev/null 2>&1; then
  nohup bash /work/bin/peach_watch_ollama.sh >/work/logs/ollama_watch.nohup 2>&1 &
  echo OLLAMA_WATCH_STARTED
else
  echo OLLAMA_WATCH_OK
fi

curl -sf -m 5 http://127.0.0.1:8188/system_stats >/dev/null && echo REMOTE_COMFY_OK || echo REMOTE_COMFY_FAIL
curl -sf -m 5 http://127.0.0.1:11434/api/tags >/dev/null && echo REMOTE_OLLAMA_OK || echo REMOTE_OLLAMA_FAIL
`;
  const r = sshRun(cfg, remote, 180_000);
  process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr.slice(-400));
  if (!r.stdout.includes("REMOTE_COMFY_OK")) {
    throw new Error("remote Comfy not healthy");
  }
  if (!r.stdout.includes("REMOTE_OLLAMA_OK")) {
    console.warn("[stack] warning: remote Ollama not healthy (video uses prompt fallback)");
  }
}

function freePort(port) {
  if (process.platform !== "win32") return;
  spawnSync(
    "powershell",
    [
      "-NoProfile",
      "-Command",
      `Get-NetTCPConnection -LocalPort ${port} -State Listen -EA SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -EA SilentlyContinue }`,
    ],
    { windowsHide: true },
  );
}

function startDetached(cmd, args, logName) {
  const logPath = path.join(ROOT, "data", "logs", logName);
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const out = fs.openSync(logPath, "a");
  // NEVER use shell:true — breaks paths with spaces (Program Files / Проект Х)
  const child = spawn(cmd, args, {
    cwd: ROOT,
    detached: true,
    stdio: ["ignore", out, out],
    windowsHide: true,
    env: process.env,
    shell: false,
  });
  child.unref();
  return { pid: child.pid, logPath };
}

function resolveNpm() {
  if (process.platform !== "win32") return "npm";
  const candidates = [
    path.join(path.dirname(process.execPath), "npm.cmd"),
    "C:\\Program Files\\nodejs\\npm.cmd",
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return "npm.cmd";
}

async function waitUrl(url, label, timeoutMs = 90_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (await ping(url)) {
      console.log(`[stack] ${label} OK`);
      return true;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  console.error(`[stack] ${label} FAILED (${url})`);
  return false;
}

async function main() {
  const cfg = loadCfg();
  if (!fs.existsSync(cfg.sshKeyPath)) {
    throw new Error(`SSH key missing: ${cfg.sshKeyPath}`);
  }

  const llmCfgPath = path.join(ROOT, "infra", "metalnode.llm.json");
  const llmSplit = fs.existsSync(llmCfgPath);
  let llmCfg = null;
  if (llmSplit) {
    llmCfg = JSON.parse(fs.readFileSync(llmCfgPath, "utf8"));
  }

  // When LLM is on a separate node, don't expect Ollama on the Comfy machine
  if (!llmSplit) {
    ensureRemote(cfg);
  } else {
    console.log("[stack] split LLM node — ensuring Comfy only on GPU…");
    const r = sshRun(
      cfg,
      `curl -sf -m 5 http://127.0.0.1:8188/system_stats >/dev/null && echo REMOTE_COMFY_OK || echo REMOTE_COMFY_FAIL`,
      60_000,
    );
    process.stdout.write(r.stdout);
    if (!r.stdout.includes("REMOTE_COMFY_OK")) {
      throw new Error("remote Comfy not healthy");
    }
  }

  const ollamaUrl = llmSplit
    ? llmCfg.llmOllamaUrl || "http://127.0.0.1:11435"
    : "http://127.0.0.1:11434";

  // Tunnel keepalive — skip if already healthy (avoids duplicate tunnels flapping)
  let ollamaOk = await ping(`${ollamaUrl.replace(/\/$/, "")}/api/tags`);
  const comfyLocal = await ping("http://127.0.0.1:8188/system_stats");
  if (comfyLocal && ollamaOk) {
    console.log("[stack] tunnel already healthy — keeping existing SSH");
  } else {
    console.log("[stack] starting tunnel keepalive…");
    if (process.platform === "win32") {
      spawnSync(
        "powershell",
        [
          "-NoProfile",
          "-Command",
          "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'metalnode-tunnel|metalnode-llm-tunnel' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -EA SilentlyContinue }",
        ],
        { windowsHide: true },
      );
    }
    freePort(8188);
    if (llmSplit) freePort(11435);
    else freePort(11434);
    await new Promise((r) => setTimeout(r, 500));

    const tunnel = startDetached(
      process.execPath,
      [path.join(ROOT, "scripts", "start-comfy-tunnel-detached.mjs")],
      "tunnel.log",
    );
    console.log(`[stack] comfy tunnel pid=${tunnel.pid} log=${tunnel.logPath}`);

    if (llmSplit) {
      const llmTunnel = startDetached(
        process.execPath,
        [path.join(ROOT, "scripts", "metalnode-llm-tunnel.mjs")],
        "llm-tunnel.log",
      );
      console.log(`[stack] llm tunnel pid=${llmTunnel.pid} log=${llmTunnel.logPath}`);
    }

    const comfyOk = await waitUrl(
      "http://127.0.0.1:8188/system_stats",
      "Comfy tunnel",
      60_000,
    );
    ollamaOk = await waitUrl(
      `${ollamaUrl.replace(/\/$/, "")}/api/tags`,
      "Ollama tunnel",
      60_000,
    );
    if (!comfyOk) throw new Error("Comfy tunnel not up");
  }

  // Next.js — start only if down (avoid killing healthy app mid-test)
  const nextUp = await ping("http://127.0.0.1:3000/");
  if (nextUp) {
    console.log("[stack] Next.js already up on :3000");
  } else {
    console.log("[stack] starting Next.js on :3000…");
    freePort(3000);
    await new Promise((r) => setTimeout(r, 800));
    runSync("npx", ["prisma", "db", "push", "--skip-generate"], { shell: isWin });
    runSync("npx", ["prisma", "generate"], { shell: isWin });
    const next = startDetached(resolveNpm(), ["run", "dev:next"], "next-dev.log");
    console.log(`[stack] next pid=${next.pid} log=${next.logPath}`);
    const appOk = await waitUrl("http://127.0.0.1:3000/", "Next.js", 90_000);
    if (!appOk) throw new Error("Next.js not up");
  }

  console.log("");
  console.log("Ready for testing:");
  console.log("  App     http://127.0.0.1:3000");
  console.log("  Comfy   http://127.0.0.1:8188");
  console.log(`  Ollama  ${ollamaUrl} ${ollamaOk ? "(ok)" : "(down)"}`);
  console.log("Keep this machine online; tunnels auto-reconnect if SSH drops.");
}

main().catch((e) => {
  console.error("[stack]", e.message || e);
  process.exit(1);
});
