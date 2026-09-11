/**
 * Direct GPU train driver (bypasses Railway SSH thread storm).
 * Uploads local photo folders → Metalnode → starts peach_krea2_lora_train → marks lab ready.
 *
 * Usage: node scripts/overnight-lab-train-direct.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SECRET = process.env.BOOTSTRAP_ADMIN_SECRET || "pb-bootstrap-2026-oleg";
const API =
  process.env.BOOTSTRAP_URL ||
  "https://bot-production-c305.up.railway.app/api/peach/bootstrap-admin";
const OWNER = process.env.LAB_OWNER_USER_ID || "cmsa0ko34000bv9cgjm27ydny";
const LORAS_ROOT =
  process.env.LORAS_ROOT || path.join("C:\\Users\\Олег\\Desktop\\Проект Х\\Лоры");
const KEY = path.join(ROOT, "infra", "metalnode-comfy-22026.key");
const STATE_PATH = path.join(ROOT, "data", "overnight-lab-loras-state.json");
const SCRIPT_LOCAL = path.join(ROOT, "scripts", "metalnode_krea2_lora_train_generic.sh");
const IMG_EXT = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const EPOCHS = 12;

const TRAIN_FOLDERS = [
  { folder: "Дошик", name: "Doshik", trigger: "doshik" },
  { folder: "Инстасамка", name: "Instasamka", trigger: "instasamka" },
  { folder: "МашМилаш", name: "MashMilash", trigger: "mashmilash" },
  { folder: "Сабина", name: "Sabina", trigger: "sabina" },
  { folder: "СедиСинк", name: "SediSink", trigger: "sedisink" },
];

function log(...a) {
  console.log(new Date().toISOString(), ...a);
}
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
  } catch {
    return { ready: {}, train: {} };
  }
}
function saveState(state) {
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

function metalEnv() {
  return {
    ...process.env,
    METALNODE_HOST: process.env.METALNODE_HOST || "77.94.203.13",
    METALNODE_SSH_PORT: process.env.METALNODE_SSH_PORT || "22026",
    METALNODE_SSH_USER: process.env.METALNODE_SSH_USER || "root",
    METALNODE_SSH_KEY_PATH: KEY,
  };
}

function runWorker(args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const worker = path.join(ROOT, "scripts", "metalnode-ssh2-worker.mjs");
    const child = spawn(process.execPath, [worker, ...args], {
      env: metalEnv(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    const t = setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* ignore */
      }
      reject(new Error(`worker timeout ${timeoutMs}`));
    }, timeoutMs + 5_000);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", (code) => {
      clearTimeout(t);
      if (code === 0) resolve(out);
      else reject(new Error(`worker exit ${code}: ${out.slice(0, 600)}`));
    });
  });
}

function sshExec(cmd, timeoutMs = 120_000) {
  return runWorker(["exec", String(timeoutMs), cmd], timeoutMs);
}
function sshUpload(local, remote, timeoutMs = 600_000) {
  return runWorker(["upload", String(timeoutMs), local, remote], timeoutMs);
}
function sshUploadDir(localDir, remoteDir, timeoutMs = 900_000) {
  // Prefer file-by-file upload: Windows `tar | ssh` upload-dir often hangs.
  return (async () => {
    await sshExec(`mkdir -p ${JSON.stringify(remoteDir)}`, 60_000);
    const files = fs.readdirSync(localDir);
    for (const f of files) {
      const abs = path.join(localDir, f);
      if (!fs.statSync(abs).isFile()) continue;
      const remote = `${remoteDir.replace(/\/$/, "")}/${f}`;
      log(`  upload ${f}`);
      await sshUpload(abs, remote, Math.min(timeoutMs, 300_000));
    }
    return `uploaded ${files.length} entries`;
  })();
}

async function apiJson(body, retries = 10) {
  let last;
  for (let i = 1; i <= retries; i++) {
    try {
      const res = await fetch(API, {
        method: "POST",
        headers: {
          "x-bootstrap-secret": SECRET,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      let json;
      try {
        json = JSON.parse(text);
      } catch {
        throw new Error(`bad json ${res.status}: ${text.slice(0, 200)}`);
      }
      if (!res.ok) throw new Error(JSON.stringify(json).slice(0, 400));
      return json;
    } catch (e) {
      last = e;
      await sleep(Math.min(90_000, 5_000 * i));
    }
  }
  throw last;
}

async function ensureLabCharacter(spec, state) {
  const key = spec.trigger;
  if (state.train[key]?.characterId) return state.train[key].characterId;
  const created = await apiJson({
    action: "lab_create_character",
    userId: OWNER,
    name: spec.name,
    triggerWord: spec.trigger,
    gender: "female",
  });
  state.train[key] = {
    ...(state.train[key] || {}),
    characterId: created.character.id,
    name: spec.name,
    status: "created",
  };
  saveState(state);
  return created.character.id;
}

async function markReady(spec, state) {
  const loraPath = `krea2/${spec.trigger}_krea2.safetensors`;
  const row = await apiJson({
    action: "lab_set_ready_lora",
    userId: OWNER,
    name: spec.name,
    triggerWord: spec.trigger,
    loraPath,
  });
  state.train[spec.trigger] = {
    ...(state.train[spec.trigger] || {}),
    characterId: row.character?.id,
    name: spec.name,
    status: "ready",
    loraPath,
    at: new Date().toISOString(),
  };
  saveState(state);
  log(`READY ${spec.name} -> ${loraPath}`);
}

async function remoteHasLora(trigger) {
  const remote = `/work/ComfyUI/models/loras/krea2/${trigger}_krea2.safetensors`;
  const out = await sshExec(
    `if [ -f ${JSON.stringify(remote)} ]; then ls -lh ${JSON.stringify(remote)}; echo HAS_LORA; else echo MISSING; fi`,
    60_000,
  );
  return out.includes("HAS_LORA");
}

async function prepareCaptions(imgDir, trigger) {
  // Write/update .txt captions next to images in a temp staging dir
  const staging = path.join(ROOT, "data", "train-staging", trigger);
  fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(staging, { recursive: true });
  const files = fs
    .readdirSync(imgDir)
    .filter((f) => IMG_EXT.has(path.extname(f).toLowerCase()));
  for (const f of files) {
    fs.copyFileSync(path.join(imgDir, f), path.join(staging, f));
    const base = f.replace(/\.[^.]+$/, "");
    fs.writeFileSync(path.join(staging, `${base}.txt`), `${trigger}\n`, "utf8");
  }
  return { staging, count: files.length };
}

async function trainOne(spec, state) {
  const key = spec.trigger;
  if (state.train[key]?.status === "ready") {
    log(`skip ${key} ready`);
    return;
  }
  await ensureLabCharacter(spec, state);

  if (await remoteHasLora(key)) {
    await markReady(spec, state);
    return;
  }

  const localFolder = path.join(LORAS_ROOT, spec.folder);
  const { staging, count } = await prepareCaptions(localFolder, key);
  if (count < 5) throw new Error(`${key}: only ${count} photos`);
  log(`${spec.name}: upload ${count} photos`);

  const remoteImg = `/work/datasets/${key}/images`;
  await sshExec(
    `mkdir -p /work/bin /work/loras_out /work/datasets/${key} && rm -rf ${JSON.stringify(remoteImg)} && mkdir -p ${JSON.stringify(remoteImg)}`,
    60_000,
  );
  await sshUploadDir(staging, remoteImg, 900_000);
  const cntOut = await sshExec(
    `find ${JSON.stringify(remoteImg)} -maxdepth 1 -type f \\( -iname '*.png' -o -iname '*.jpg' -o -iname '*.jpeg' -o -iname '*.webp' \\) | wc -l`,
    60_000,
  );
  const remoteCount = Number((cntOut || "").trim().split(/\s+/).pop());
  log(`${spec.name}: remote photos ${remoteCount}`);
  if (!(remoteCount >= 5)) throw new Error(`remote photo count ${remoteCount}`);

  // Upload train script
  await sshUpload(SCRIPT_LOCAL, "/work/bin/peach_krea2_lora_train.sh", 120_000);
  await sshExec(`chmod +x /work/bin/peach_krea2_lora_train.sh`, 30_000);

  const remoteStart = `/work/loras_out/${key}_start.sh`;
  const remotePid = `/work/loras_out/${key}_train.pid`;
  const remoteNohup = `/work/loras_out/${key}_nohup.log`;
  const remoteLog = `/work/loras_out/${key}_train.log`;
  const startBody = [
    "#!/bin/bash",
    "set -euo pipefail",
    `export PEACH_TRIGGER=${JSON.stringify(key)}`,
    `export PEACH_SLUG=${JSON.stringify(key)}`,
    `export PEACH_EPOCHS=${JSON.stringify(String(EPOCHS))}`,
    "mkdir -p /work/loras_out /work/bin",
    "chmod +x /work/bin/peach_krea2_lora_train.sh",
    `if [ -f ${JSON.stringify(remotePid)} ]; then kill "$(cat ${JSON.stringify(remotePid)})" 2>/dev/null || true; fi`,
    `nohup bash /work/bin/peach_krea2_lora_train.sh >${JSON.stringify(remoteNohup)} 2>&1 &`,
    `echo $! > ${JSON.stringify(remotePid)}`,
    "sleep 3",
    `PID="$(cat ${JSON.stringify(remotePid)})"`,
    'if kill -0 "$PID" 2>/dev/null; then echo "STARTED:$PID"; exit 0; fi',
    "echo START_FAIL",
    `tail -n 40 ${JSON.stringify(remoteNohup)} 2>/dev/null || true`,
    `tail -n 40 ${JSON.stringify(remoteLog)} 2>/dev/null || true`,
    "exit 1",
    "",
  ].join("\n");

  const tmpStart = path.join(ROOT, "data", "train-staging", `${key}_start.sh`);
  fs.writeFileSync(tmpStart, startBody.replace(/\r\n/g, "\n"), "utf8");
  await sshUpload(tmpStart, remoteStart, 60_000);
  await sshExec(`chmod +x ${JSON.stringify(remoteStart)} && bash ${JSON.stringify(remoteStart)}`, 180_000);

  state.train[key] = {
    ...(state.train[key] || {}),
    status: "training",
    photosUploaded: remoteCount,
    startedAt: new Date().toISOString(),
  };
  saveState(state);
  log(`${spec.name}: training started`);

  const deadline = Date.now() + 3.5 * 60 * 60 * 1000;
  while (Date.now() < deadline) {
    await sleep(90_000);
    const probe = await sshExec(
      [
        `echo ---MARKERS---`,
        `grep -E 'TRAIN_DONE|ALL_DONE|TRAIN_FAIL|NO_LORA|TOO_FEW|TRAIN_START|steps:' ${JSON.stringify(remoteLog)} 2>/dev/null | tail -15 || true`,
        `echo ---LORA---`,
        `ls -lh /work/ComfyUI/models/loras/krea2/${key}_krea2.safetensors 2>/dev/null || echo MISSING`,
        `echo ---PID---`,
        `if [ -f ${JSON.stringify(remotePid)} ]; then PID=$(cat ${JSON.stringify(remotePid)}); if kill -0 "$PID" 2>/dev/null; then echo RUNNING; else echo DEAD; fi; else echo NOPID; fi`,
      ].join("\n"),
      90_000,
    );
    const line = (probe.match(/steps:[^\n]*/)?.[0] || probe.match(/TRAIN_[A-Z]+/)?.[0] || "").slice(
      0,
      120,
    );
    log(`poll ${spec.name}: ${line || probe.slice(0, 160).replace(/\s+/g, " ")}`);
    state.train[key].lastProbe = line || probe.slice(0, 200);
    saveState(state);

    if (/TRAIN_FAIL|NO_LORA|TOO_FEW/.test(probe)) {
      throw new Error(`train failed: ${probe.slice(0, 400)}`);
    }
    if (
      probe.includes("HAS_LORA") ||
      (/TRAIN_DONE|ALL_DONE/.test(probe) &&
        !probe.includes("MISSING") &&
        probe.includes(`${key}_krea2.safetensors`))
    ) {
      await markReady(spec, state);
      return;
    }
    // Train finished saving but promote step may have died — pick up from loras_out.
    if (/saving checkpoint:|model saved|100%\|██████████\|/.test(probe) && /DEAD|NOPID/.test(probe)) {
      await sshExec(
        [
          `mkdir -p /work/ComfyUI/models/loras/krea2`,
          `LATEST=$(ls -1t /work/loras_out/${key}/*.safetensors 2>/dev/null | head -1 || true)`,
          `if [ -n "$LATEST" ]; then cp -f "$LATEST" /work/ComfyUI/models/loras/krea2/${key}_krea2.safetensors; fi`,
        ].join("; "),
        120_000,
      );
    }
    if (await remoteHasLora(key)) {
      await markReady(spec, state);
      return;
    }
  }
  throw new Error(`${spec.name} train timeout`);
}

async function main() {
  log("direct GPU train start");
  if (!fs.existsSync(SCRIPT_LOCAL)) throw new Error("missing train script");
  const state = loadState();
  saveState(state);

  for (const spec of TRAIN_FOLDERS) {
    for (let attempt = 1; attempt <= 5; attempt++) {
      try {
        await trainOne(spec, state);
        break;
      } catch (e) {
        log(`FAIL ${spec.name} attempt ${attempt}:`, e);
        state.train[spec.trigger] = {
          ...(state.train[spec.trigger] || {}),
          error: e instanceof Error ? e.message : String(e),
        };
        saveState(state);
        await sleep(45_000 * attempt);
      }
    }
    await sleep(30_000);
  }

  log("ALL DONE");
  log(JSON.stringify(state.train, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
