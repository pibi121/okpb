/**
 * Overnight brick eval supervisor: actions then combo.
 *   node scripts/brick-eval-overnight.mjs
 */
import http from "node:http";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LOG_PATH = path.join(ROOT, "data", "logs", "brick-eval-overnight.log");
const TUNNEL_STARTER = path.join(ROOT, "scripts", "start-comfy-tunnel-detached.mjs");
const WATCHDOG = path.join(ROOT, "scripts", "comfy-tunnel-watchdog.mjs");
const TICK_MS = 20_000;
const MAX_HOURS = 12;

const QUEUE = [
  {
    kind: "actions",
    clips: path.join(ROOT, "data", "action-eval-clips-batch1.json"),
    log: path.join(ROOT, "data", "logs", "action-eval-batch1.log"),
  },
  {
    kind: "combo",
    clips: path.join(ROOT, "data", "combo-eval-clips-v1.json"),
    log: path.join(ROOT, "data", "logs", "combo-eval-v1.log"),
  },
];

let queueIdx = 0;

function log(msg) {
  const line = `[brick-overnight] ${new Date().toISOString()} ${msg}`;
  console.log(line);
  fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
  fs.appendFileSync(LOG_PATH, line + "\n", "utf8");
}

function currentJob() {
  return QUEUE[queueIdx] || null;
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
  log(`remote comfy: ${(r.stdout || "").trim()}`);
}

function readProgress(clipsPath) {
  try {
    const doc = JSON.parse(fs.readFileSync(clipsPath, "utf8"));
    const clips = doc.clips || [];
    const ready = clips.filter((c) => c.status === "ready").length;
    const total = doc.totalExpected || clips.length;
    return { ready, total, hasClips: clips.length > 0, status: doc.status };
  } catch {
    return { ready: 0, total: 0, hasClips: false, status: "pending" };
  }
}

function isBatchRunning() {
  if (process.platform === "win32") {
    const r = spawnSync(
      "cmd.exe",
      [
        "/d",
        "/s",
        "/c",
        "wmic process where \"commandline like '%run-brick-eval-batch%'\" get processid 2>nul | findstr /r \"[0-9]\"",
      ],
      { encoding: "utf8", windowsHide: true, timeout: 15_000 },
    );
    return Boolean((r.stdout || "").trim());
  }
  const r = spawnSync("pgrep", ["-f", "run-brick-eval-batch"], {
    encoding: "utf8",
  });
  return Boolean((r.stdout || "").trim());
}

function runBatch(kind, resume, retryErrors) {
  const args = [
    "tsx",
    "scripts/run-brick-eval-batch.ts",
    `--kind=${kind}`,
    ...(resume ? ["--resume"] : []),
    ...(retryErrors ? ["--retry-errors"] : []),
  ];
  log(`spawn ${args.join(" ")}`);
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

async function main() {
  const deadline = Date.now() + MAX_HOURS * 3600 * 1000;
  log(`started overnight queue (${QUEUE.length} jobs), deadline ${MAX_HOURS}h`);

  await ensureRemoteComfy();
  restartTunnel();
  for (let i = 0; i < 30; i++) {
    if (await pingComfy()) break;
    await new Promise((r) => setTimeout(r, 2000));
  }

  const wd = spawn(process.execPath, [WATCHDOG], {
    cwd: ROOT,
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  wd.unref();

  let batchRunning = false;
  let spawnedBatch = false;
  let firstRunForJob = true;

  while (Date.now() < deadline) {
    const job = currentJob();
    if (!job) {
      log("ALL QUEUE DONE");
      break;
    }

    const prog = readProgress(job.clips);
    if (prog.ready >= prog.total && prog.total > 0) {
      log(`${job.kind} DONE ${prog.ready}/${prog.total}`);
      queueIdx += 1;
      firstRunForJob = true;
      batchRunning = false;
      spawnedBatch = false;
      continue;
    }

    if (batchRunning && !spawnedBatch && !isBatchRunning()) {
      batchRunning = false;
      firstRunForJob = false;
    }

    if (!batchRunning) {
      if (isBatchRunning()) {
        batchRunning = true;
        log(`${job.kind} already running`);
      } else if (!(await pingComfy())) {
        log("comfy down");
        restartTunnel();
        await new Promise((r) => setTimeout(r, 15_000));
      } else {
        batchRunning = true;
        spawnedBatch = true;
        const resume = prog.hasClips || !firstRunForJob;
        const child = runBatch(job.kind, resume, resume);
        firstRunForJob = false;

        const batchLog = fs.createWriteStream(job.log, { flags: "a" });
        child.stdout?.on("data", (d) => batchLog.write(d));
        child.stderr?.on("data", (d) => batchLog.write(d));
        child.on("close", (code) => {
          batchLog.end();
          batchRunning = false;
          spawnedBatch = false;
          const p = readProgress(job.clips);
          log(`${job.kind} exited code=${code} progress=${p.ready}/${p.total}`);
        });
        child.on("error", (e) => {
          batchLog.end();
          batchRunning = false;
          spawnedBatch = false;
          log(`spawn error: ${e.message}`);
        });
      }
    }

    await new Promise((r) => setTimeout(r, TICK_MS));
  }

  const job = currentJob();
  if (job) {
    const p = readProgress(job.clips);
    log(`supervisor end at job=${job.kind} progress=${p.ready}/${p.total}`);
  } else {
    log("supervisor end — all jobs done");
  }
}

main().catch((e) => {
  log(`FATAL ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
