/**
 * Overnight lab LoRA seed:
 * 1) Upload ready .safetensors from «Готовые лоры» to Metalnode + create lab characters
 * 2) Create train characters from photo folders, upload images (no age-gate), train sequentially
 *
 * Usage:
 *   node scripts/overnight-lab-loras.mjs
 *
 * Env:
 *   BOOTSTRAP_ADMIN_SECRET (default pb-bootstrap-2026-oleg)
 *   LAB_OWNER_USER_ID (default Oleg web lab)
 *   LORAS_ROOT (default Desktop/Проект Х/Лоры)
 */
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SECRET = process.env.BOOTSTRAP_ADMIN_SECRET || "pb-bootstrap-2026-oleg";
const API = process.env.BOOTSTRAP_URL || "https://bot-production-c305.up.railway.app/api/peach/bootstrap-admin";
const OWNER = process.env.LAB_OWNER_USER_ID || "cmsa0ko34000bv9cgjm27ydny";
const LORAS_ROOT =
  process.env.LORAS_ROOT ||
  path.join("C:\\Users\\Олег\\Desktop\\Проект Х\\Лоры");
const KEY = path.join(ROOT, "infra", "metalnode-comfy-22026.key");
const STATE_PATH = path.join(ROOT, "data", "overnight-lab-loras-state.json");
const IMG_EXT = new Set([".png", ".jpg", ".jpeg", ".webp"]);

const TRAIN_FOLDERS = [
  { folder: "Дошик", name: "Doshik", trigger: "doshik" },
  { folder: "Инстасамка", name: "Instasamka", trigger: "instasamka" },
  { folder: "МашМилаш", name: "MashMilash", trigger: "mashmilash" },
  { folder: "Сабина", name: "Sabina", trigger: "sabina" },
  { folder: "СедиСинк", name: "SediSink", trigger: "sedisink" },
];

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
  } catch {
    return { ready: {}, train: {}, log: [] };
  }
}

function saveState(state) {
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function isTransientHttp(status, text) {
  if ([502, 503, 504, 429].includes(status)) return true;
  const s = String(text || "");
  return /EAGAIN|timeout|upstream|metalnode_unreachable|Application failed to respond|uv_thread_create/i.test(
    s,
  );
}

async function apiJson(body, { retries = 8 } = {}) {
  let lastErr;
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
        if (isTransientHttp(res.status, text) && i < retries) {
          await sleep(Math.min(120_000, 8_000 * i));
          continue;
        }
        throw new Error(`bad json ${res.status}: ${text.slice(0, 300)}`);
      }
      if (!res.ok) {
        const msg = JSON.stringify(json).slice(0, 500);
        if (isTransientHttp(res.status, msg) && i < retries) {
          await sleep(Math.min(120_000, 8_000 * i));
          continue;
        }
        throw new Error(msg);
      }
      return json;
    } catch (e) {
      lastErr = e;
      const msg = e instanceof Error ? e.message : String(e);
      if (isTransientHttp(0, msg) && i < retries) {
        await sleep(Math.min(120_000, 8_000 * i));
        continue;
      }
      throw e;
    }
  }
  throw lastErr || new Error("apiJson failed");
}

async function apiPhoto(characterId, filePath) {
  const buf = fs.readFileSync(filePath);
  const blob = new Blob([buf], { type: "application/octet-stream" });
  const form = new FormData();
  form.set("action", "lab_add_photo");
  form.set("characterId", characterId);
  form.set("file", blob, path.basename(filePath));
  const res = await fetch(API, {
    method: "POST",
    headers: { "x-bootstrap-secret": SECRET },
    body: form,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(JSON.stringify(json).slice(0, 400));
  return json;
}

function slugify(s) {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
}

function readyMeta(fileName) {
  const base = fileName.replace(/\.safetensors$/i, "");
  let trigger = slugify(base);
  let name = base.replace(/[_-]+/g, " ").trim();
  if (/my\s*stars/i.test(base)) {
    const m = base.match(/My Stars\s*-\s*(.+)$/i);
    name = m ? m[1].trim() : base;
    trigger = slugify(name);
  } else if (/BeMyHero/i.test(base)) {
    const m = base.match(/BeMyHero_-_(.+?)(?:_epoch_\d+)?$/i);
    name = (m ? m[1] : base).replace(/_/g, " ");
    trigger = slugify(name);
  } else if (/rlyhelga/i.test(base)) {
    name = "Helga";
    trigger = "rlyhelga";
  } else if (/brigette/i.test(base)) {
    name = "Brigette";
    trigger = "brigette";
  } else if (/mefgirl/i.test(base)) {
    name = "Mefgirl";
    trigger = "mefgirl";
  } else if (/mercy/i.test(base)) {
    name = "Mercy";
    trigger = "mercyow";
  } else if (/savannah/i.test(base)) {
    name = "Savannah";
    trigger = "savannah";
  }
  const remoteName = `${trigger}_krea2.safetensors`;
  return { name, trigger, remoteName, loraPath: `krea2/${remoteName}` };
}

function sshUpload(localPath, remotePath) {
  return new Promise((resolve, reject) => {
    const worker = path.join(ROOT, "scripts", "metalnode-ssh2-worker.mjs");
    const env = {
      ...process.env,
      METALNODE_HOST: process.env.METALNODE_HOST || "77.94.203.13",
      METALNODE_SSH_PORT: process.env.METALNODE_SSH_PORT || "22026",
      METALNODE_SSH_USER: process.env.METALNODE_SSH_USER || "root",
      METALNODE_SSH_KEY_PATH: KEY,
    };
    const child = spawn(
      process.execPath,
      [worker, "upload", String(30 * 60_000), localPath, remotePath],
      { env, stdio: ["ignore", "pipe", "pipe"] },
    );
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", (code) => {
      if (code === 0) resolve(out);
      else reject(new Error(`upload failed ${code}: ${out.slice(0, 500)}`));
    });
  });
}

function sshExec(cmd, timeoutMs = 120_000) {
  return new Promise((resolve, reject) => {
    const worker = path.join(ROOT, "scripts", "metalnode-ssh2-worker.mjs");
    const env = {
      ...process.env,
      METALNODE_HOST: process.env.METALNODE_HOST || "77.94.203.13",
      METALNODE_SSH_PORT: process.env.METALNODE_SSH_PORT || "22026",
      METALNODE_SSH_USER: process.env.METALNODE_SSH_USER || "root",
      METALNODE_SSH_KEY_PATH: KEY,
    };
    const child = spawn(
      process.execPath,
      [worker, "exec", String(timeoutMs), cmd],
      { env, stdio: ["ignore", "pipe", "pipe"] },
    );
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", (code) => {
      if (code === 0) resolve(out);
      else reject(new Error(`exec failed ${code}: ${out.slice(0, 500)}`));
    });
  });
}

async function importReadyLoras(state) {
  const dir = path.join(LORAS_ROOT, "Готовые лоры");
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith(".safetensors"));
  log(`ready loras: ${files.length}`);
  await sshExec("mkdir -p /work/ComfyUI/models/loras/krea2", 60_000);

  for (const file of files) {
    const meta = readyMeta(file);
    if (state.ready[meta.trigger]?.ok) {
      log(`skip ready ${meta.trigger} (done)`);
      continue;
    }
    const local = path.join(dir, file);
    const remote = `/work/ComfyUI/models/loras/${meta.loraPath}`;
    log(`upload ready ${file} -> ${remote}`);
    try {
      const exists = await sshExec(
        `test -f ${JSON.stringify(remote)} && ls -lh ${JSON.stringify(remote)} || echo MISSING`,
        60_000,
      );
      if (!exists.includes("MISSING") && exists.includes("M")) {
        log(`already on GPU: ${meta.loraPath}`);
      } else {
        await sshUpload(local, remote);
      }
      const row = await apiJson({
        action: "lab_set_ready_lora",
        userId: OWNER,
        name: meta.name,
        triggerWord: meta.trigger,
        loraPath: meta.loraPath,
      });
      state.ready[meta.trigger] = {
        ok: true,
        characterId: row.character?.id,
        loraPath: meta.loraPath,
        name: meta.name,
        at: new Date().toISOString(),
      };
      saveState(state);
      log(`ready OK ${meta.name} (${meta.trigger}) id=${row.character?.id}`);
    } catch (e) {
      state.ready[meta.trigger] = {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
        at: new Date().toISOString(),
      };
      saveState(state);
      log(`ready FAIL ${meta.trigger}:`, e);
    }
  }
}

async function promoteIfRemoteReady(characterId, trigger, name, state, key) {
  const remote = `/work/ComfyUI/models/loras/krea2/${trigger}_krea2.safetensors`;
  try {
    const out = await sshExec(
      `if [ -f ${JSON.stringify(remote)} ]; then ls -lh ${JSON.stringify(remote)}; echo HAS_LORA; else echo MISSING; fi`,
      90_000,
    );
    if (!out.includes("HAS_LORA")) return false;
    const row = await apiJson({
      action: "lab_set_ready_lora",
      userId: OWNER,
      name,
      triggerWord: trigger,
      loraPath: `krea2/${trigger}_krea2.safetensors`,
    });
    state.train[key] = {
      ...state.train[key],
      characterId: row.character?.id || characterId,
      status: "ready",
      loraPath: `krea2/${trigger}_krea2.safetensors`,
      at: new Date().toISOString(),
    };
    saveState(state);
    log(`remote promote READY ${name}`);
    return true;
  } catch (e) {
    log(`promote check fail ${trigger}:`, e);
    return false;
  }
}

async function seedAndTrain(state) {
  for (const spec of TRAIN_FOLDERS) {
    const key = spec.trigger;
    if (state.train[key]?.status === "ready") {
      log(`train skip ${key} already ready`);
      continue;
    }

    const folder = path.join(LORAS_ROOT, spec.folder);
    const photos = fs
      .readdirSync(folder)
      .filter((f) => IMG_EXT.has(path.extname(f).toLowerCase()))
      .map((f) => path.join(folder, f));
    log(`train prepare ${spec.name}: ${photos.length} photos`);

    let characterId = state.train[key]?.characterId;
    if (!characterId) {
      const created = await apiJson({
        action: "lab_create_character",
        userId: OWNER,
        name: spec.name,
        triggerWord: spec.trigger,
        gender: "female",
      });
      characterId = created.character.id;
      state.train[key] = {
        characterId,
        name: spec.name,
        status: "created",
        photosUploaded: 0,
      };
      saveState(state);
    }

    if (await promoteIfRemoteReady(characterId, spec.trigger, spec.name, state, key)) {
      continue;
    }

    // Upload photos (idempotent enough — may duplicate if re-run; check count first)
    const status0 = await apiJson({ action: "lab_train_status", characterId });
    let have = status0.photos || 0;
    if (have < Math.min(5, photos.length)) {
      for (const p of photos) {
        try {
          const r = await apiPhoto(characterId, p);
          have = r.photoCount || have + 1;
          state.train[key].photosUploaded = have;
          saveState(state);
          log(`photo ${path.basename(p)} -> ${have}`);
        } catch (e) {
          log(`photo fail ${path.basename(p)}:`, e);
        }
      }
    } else {
      log(`photos already present: ${have}`);
    }

    // Start / resume train
    for (let attempt = 1; attempt <= 6; attempt++) {
      try {
        const st = await apiJson({ action: "lab_train_status", characterId });
        if (st.character?.loraStatus === "lora_ready" && st.character?.loraPath) {
          state.train[key] = {
            ...state.train[key],
            status: "ready",
            loraPath: st.character.loraPath,
            at: new Date().toISOString(),
          };
          saveState(state);
          log(`TRAIN READY ${spec.name}`);
          break;
        }

        const alreadyTraining =
          st.character?.loraStatus === "lora_training" ||
          st.trainMeta?.status === "training" ||
          st.trainMeta?.status === "uploading";
        const force =
          !alreadyTraining &&
          (attempt > 1 || st.trainMeta?.status === "error");

        log(`start train ${spec.name} attempt ${attempt} force=${force}`);
        await apiJson({
          action: "lab_start_train",
          characterId,
          force,
          skipAgeGate: true,
        });
        state.train[key].status = "training";
        saveState(state);

        // Poll up to ~3.5h — tolerate transient API/SSH flaps
        const deadline = Date.now() + 3.5 * 60 * 60 * 1000;
        let ready = false;
        let consecutiveErrors = 0;
        while (Date.now() < deadline) {
          await sleep(90_000);
          let cur;
          try {
            cur = await apiJson({ action: "lab_train_status", characterId }, { retries: 6 });
            consecutiveErrors = 0;
          } catch (e) {
            consecutiveErrors += 1;
            log(`poll soft-fail ${spec.name} (${consecutiveErrors}):`, e);
            if (consecutiveErrors >= 12) throw e;
            continue;
          }
          const meta = cur.trainMeta || {};
          log(
            `poll ${spec.name}: lora=${cur.character?.loraStatus} meta=${meta.status} ${meta.percent || 0}% ${meta.phase || meta.lastLine || ""}`,
          );
          state.train[key] = {
            ...state.train[key],
            status: cur.character?.loraStatus || "training",
            percent: meta.percent,
            phase: meta.phase,
            error: meta.error,
            loraPath: cur.character?.loraPath,
          };
          saveState(state);
          if (cur.character?.loraStatus === "lora_ready" && cur.character?.loraPath) {
            state.train[key].status = "ready";
            saveState(state);
            ready = true;
            log(`TRAIN READY ${spec.name}`);
            break;
          }
          if (meta.status === "error") {
            throw new Error(meta.error || "train meta error");
          }
        }
        if (ready) break;
        throw new Error("train timeout");
      } catch (e) {
        log(`train attempt fail ${spec.name}:`, e);
        state.train[key].error = e instanceof Error ? e.message : String(e);
        saveState(state);
        await sleep(60_000 * Math.min(attempt, 5));
      }
    }

    // Cool down Metalnode/Railway between characters (SSH worker thread storms)
    await sleep(90_000);
  }
}

async function main() {
  log("overnight lab loras start");
  log("LORAS_ROOT", LORAS_ROOT);
  if (!fs.existsSync(LORAS_ROOT)) throw new Error(`missing ${LORAS_ROOT}`);
  const state = loadState();
  saveState(state);

  await importReadyLoras(state);
  await seedAndTrain(state);

  log("DONE summary");
  log(JSON.stringify({ ready: state.ready, train: state.train }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
