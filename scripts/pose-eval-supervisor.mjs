/**
 * Keeps Comfy tunnel + Next.js + pose-eval batch2 alive (~8h session).
 * Restarts tunnel on failure, resumes batch with error retry.
 *
 *   node scripts/pose-eval-supervisor.mjs
 */
import http from "node:http";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const batchArg = process.argv.find((a) => a.startsWith("--batch="))?.split("=")[1] || "2";
const CLIPS_PATH = path.join(ROOT, "data", `pose-eval-clips-batch${batchArg}.json`);
const LOG_PATH = path.join(ROOT, "data", "logs", "pose-eval-supervisor.log");
const TUNNEL_STARTER = path.join(ROOT, "scripts", "start-comfy-tunnel-detached.mjs");
const WATCHDOG = path.join(ROOT, "scripts", "comfy-tunnel-watchdog.mjs");
const BATCH_LOG = path.join(ROOT, "data", "logs", `pose-eval-batch${batchArg}.log`);
const TICK_MS = 20_000;
const MAX_HOURS = 8;

function log(msg) {
  const line = `[supervisor] ${new Date().toISOString()} ${msg}`;
  console.log(line);
  fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
  fs.appendFileSync(LOG_PATH, line + "\n", "utf8");
}

function pingComfy() {
  return new Promise((resolve) => {
    const req = http.get(
      "http://127.0.0.1:8188/system_stats",
      { timeout: 5000 },
      (res) => {
        res.resume();
        resolve(res.statusCode >= 200 && res.statusCode < 500);
      },
    );
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
}

function pingNext() {
  return new Promise((resolve) => {
    const req = http.get("http://127.0.0.1:3000/", { timeout: 5000 }, (res) => {
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

function restartTunnel() {
  log("restart comfy tunnel");
  const child = spawn(process.execPath, [TUNNEL_STARTER], {
    cwd: ROOT,
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
}

async function ensureNext() {
  if (await pingNext()) return;
  log("starting Next.js");
  spawnSync(
    "powershell",
    [
      "-NoProfile",
      "-Command",
      `Get-NetTCPConnection -LocalPort 3000 -State Listen -EA SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -EA SilentlyContinue }`,
    ],
    { windowsHide: true },
  );
  const npm =
    process.platform === "win32"
      ? "C:\\Program Files\\nodejs\\npm.cmd"
      : "npm";
  const child = spawn(npm, ["run", "dev"], {
    cwd: ROOT,
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    shell: false,
  });
  child.unref();
}

function isBatchProcessRunning() {
  if (process.platform === "win32") {
    const r = spawnSync(
      "cmd.exe",
      [
        "/d",
        "/s",
        "/c",
        "wmic process where \"commandline like '%run-pose-eval-batch%'\" get processid 2>nul | findstr /r \"[0-9]\"",
      ],
      { encoding: "utf8", windowsHide: true, timeout: 15_000 },
    );
    return Boolean((r.stdout || "").trim());
  }
  const r = spawnSync("pgrep", ["-f", "run-pose-eval-batch"], {
    encoding: "utf8",
  });
  return Boolean((r.stdout || "").trim());
}

function readProgress() {
  try {
    const doc = JSON.parse(fs.readFileSync(CLIPS_PATH, "utf8"));
    const clips = doc.clips || [];
    const ready = clips.filter((c) => c.status === "ready").length;
    const total = doc.totalExpected || clips.length;
    return { ready, total, status: doc.status, hasClips: clips.length > 0 };
  } catch {
    return { ready: 0, total: 80, status: "unknown", hasClips: false };
  }
}

function runBatch(resume, retryErrors) {
  const args = [
    "tsx",
    "scripts/run-pose-eval-batch.ts",
    `--batch=${batchArg}`,
    ...(resume ? ["--resume"] : []),
    ...(retryErrors ? ["--retry-errors"] : []),
  ];
  log(`spawn batch ${args.join(" ")}`);
  // node + npx-cli.js — spawning npx.cmd without shell throws EINVAL on Windows.
  const node =
    process.platform === "win32"
      ? "C:\\Program Files\\nodejs\\node.exe"
      : process.execPath;
  const npxCli =
    process.platform === "win32"
      ? "C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npx-cli.js"
      : path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npx-cli.js");
  return spawn(node, [npxCli, ...args], {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    shell: false,
  });
}

async function ensureRemoteComfy() {
  const key = process.env.METALNODE_SSH_KEY_PATH || "";
  const host = process.env.METALNODE_HOST || "";
  const port = process.env.METALNODE_SSH_PORT || "22031";
  if (!key || !host) {
    log("skip remote comfy: set METALNODE_SSH_KEY_PATH and METALNODE_HOST");
    return;
  }
  const r = spawnSync(
    "ssh",
    [
      "-i",
      key,
      "-p",
      port,
      "-o",
      "BatchMode=yes",
      "-o",
      "ConnectTimeout=30",
      `root@${host}`,
      "curl -sf -m 5 http://127.0.0.1:8188/system_stats >/dev/null && echo REMOTE_OK || (cd /work/ComfyUI && nohup /work/ai/venv/bin/python main.py --listen --port 8188 --enable-manager >> /work/ComfyUI/user/comfyui_8188.log 2>&1 & sleep 15 && curl -sf -m 5 http://127.0.0.1:8188/system_stats >/dev/null && echo REMOTE_UP || echo REMOTE_FAIL)",
    ],
    { encoding: "utf8", timeout: 120_000, windowsHide: true },
  );
  log(`remote comfy: ${(r.stdout || "").trim()} ${(r.stderr || "").slice(0, 120)}`);
}

async function main() {
  const deadline = Date.now() + MAX_HOURS * 3600 * 1000;
  log(`started batch=${batchArg}, deadline in ${MAX_HOURS}h`);

  await ensureRemoteComfy();
  restartTunnel();
  for (let i = 0; i < 30; i++) {
    if (await pingComfy()) break;
    await new Promise((r) => setTimeout(r, 2000));
  }
  if (!(await pingComfy())) {
    log("comfy still down after tunnel start");
  }

  await ensureNext();

  const wd = spawn(process.execPath, [WATCHDOG], {
    cwd: ROOT,
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  wd.unref();
  log(`watchdog pid=${wd.pid}`);

  let batchRunning = false;
  let spawnedBatch = false;
  let firstRun = true;

  while (Date.now() < deadline) {
    const prog = readProgress();
    if (prog.ready >= prog.total && prog.total > 0) {
      log(`ALL DONE ${prog.ready}/${prog.total}`);
      break;
    }

    if (batchRunning && !spawnedBatch && !isBatchProcessRunning()) {
      const p = readProgress();
      log(`external batch finished progress=${p.ready}/${p.total}`);
      batchRunning = false;
      firstRun = false;
    }

    if (!batchRunning) {
      if (isBatchProcessRunning()) {
        batchRunning = true;
        log("batch already running (external), monitoring");
      } else if (!(await pingComfy())) {
        log("comfy down — tunnel restart");
        restartTunnel();
        await new Promise((r) => setTimeout(r, 15_000));
        continue;
      } else {
        batchRunning = true;
        spawnedBatch = true;
        const resume = prog.hasClips || !firstRun;
        const child = runBatch(resume, resume);
        firstRun = false;

        const batchLog = fs.createWriteStream(BATCH_LOG, { flags: "a" });
        child.stdout?.on("data", (d) => batchLog.write(d));
        child.stderr?.on("data", (d) => batchLog.write(d));

        child.on("close", (code) => {
          batchLog.end();
          batchRunning = false;
          spawnedBatch = false;
          const p = readProgress();
          log(`batch exited code=${code} progress=${p.ready}/${p.total}`);
        });

        child.on("error", (e) => {
          batchLog.end();
          batchRunning = false;
          spawnedBatch = false;
          log(`batch spawn error: ${e.message}`);
        });
      }
    }

    await new Promise((r) => setTimeout(r, TICK_MS));
  }

  const final = readProgress();
  log(`supervisor end progress=${final.ready}/${final.total}`);
}

main().catch((e) => {
  log(`FATAL ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
