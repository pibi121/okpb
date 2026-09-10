import fs from "fs";
import path from "path";
import { prisma } from "@/lib/db";
import {
  characterImagesDir,
  listCharacterPhotos,
  readTrainMeta,
  rewriteCaptions,
  sanitizeTrigger,
  writeTrainMeta,
  type CharacterTrainMeta,
} from "@/lib/character-dataset";
import { metalnodeScpDirTo, metalnodeScpTo, metalnodeSsh, metalnodeCheck } from "@/lib/metalnode-ssh";
import {
  estimateTrainTotalSec,
  formatDuration,
  parseKreaTrainLog,
  withTiming,
} from "@/lib/krea-lora-progress";
import { scheduleIdentityPackAfterTrain } from "@/lib/character-identity-pack";
import { lookbookJsonWithPromptOverlayOff } from "@/lib/lookbook";

const MIN_PHOTOS = 5;
const SCRIPT_LOCAL = path.join(process.cwd(), "scripts", "metalnode_krea2_lora_train_generic.sh");
const SCRIPT_REMOTE = "/work/bin/peach_krea2_lora_train.sh";

// Use RegExp() for patterns containing "%/" — SWC/Turbopack misparses %/ in regex literals.
const RE_TRAIN_LOG_ACTIVE = new RegExp(String.raw`TRAIN_START|steps:\s*\d+%`);
const RE_STEPS_IN_LOG = new RegExp(String.raw`steps:\s*\d+%`);

async function lookbookOffForCharacter(characterId: string): Promise<string> {
  const ch = await prisma.character.findUnique({
    where: { id: characterId },
    select: { gender: true, lookbookJson: true },
  });
  const gender = ch?.gender === "male" ? "male" : "female";
  return lookbookJsonWithPromptOverlayOff(ch?.lookbookJson, gender);
}

function trainLogLooksActive(text: string) {
  return RE_TRAIN_LOG_ACTIVE.test(text);
}

type RemoteTrainProbe = {
  slug: string;
  imageCount: number;
  running: boolean;
  done: boolean;
  failed: boolean;
  logPath: string;
  logText: string;
  loraInComfy: boolean;
  hasLoraOutput: boolean;
};

const RE_LORA_FILE = (slug: string) =>
  new RegExp(`${slug}_krea2\\.safetensors`);

function loraListedInSection(section: string, slug: string): boolean {
  if (!section.trim()) return false;
  if (/cannot access|No such file/i.test(section)) return false;
  return RE_LORA_FILE(slug).test(section);
}

/** Copy latest checkpoint from loras_out into ComfyUI loras folder if missing. */
export async function ensureKreaLoraInComfy(slug: string): Promise<boolean> {
  const comfyLora = `/work/ComfyUI/models/loras/krea2/${slug}_krea2.safetensors`;
  const outDir = `/work/loras_out/${slug}`;
  const out = await metalnodeSsh(
    [
      `if [ -f ${JSON.stringify(comfyLora)} ]; then echo COMFY_OK; exit 0; fi`,
      `LATEST=$(ls -1t ${JSON.stringify(outDir)}/*.safetensors 2>/dev/null | head -1 || true)`,
      `if [ -z "$LATEST" ]; then echo NO_SOURCE; exit 1; fi`,
      `mkdir -p /work/ComfyUI/models/loras/krea2`,
      `cp -f "$LATEST" ${JSON.stringify(comfyLora)}`,
      `ls -lh ${JSON.stringify(comfyLora)}`,
      `echo PROMOTED_OK`,
    ].join("; "),
    120_000,
  );
  return out.includes("COMFY_OK") || out.includes("PROMOTED_OK");
}

async function probeRemoteKreaTrain(slug: string): Promise<RemoteTrainProbe> {
  const remoteImg = `/work/datasets/${slug}/images`;
  const logPath = `/work/loras_out/${slug}_train.log`;
  const outDir = `/work/loras_out/${slug}`;
  const pidPath = `/work/loras_out/${slug}_train.pid`;
  // Avoid `pgrep -af '…slug…'` — it matches the probe shell itself (false RUNNING).
  const out = await metalnodeSsh(
    [
      `find ${JSON.stringify(remoteImg)} -maxdepth 1 -type f \\( -iname '*.png' -o -iname '*.jpg' -o -iname '*.jpeg' -o -iname '*.webp' \\) 2>/dev/null | wc -l`,
      `echo '---LOG---'`,
      `tail -c 16000 ${logPath} 2>/dev/null | tr '\\r' '\\n' | tail -80`,
      `echo '---MARKERS---'`,
      `grep -E 'TRAIN_DONE|ALL_DONE|TRAIN_FAIL|NO_LORA|TOO_FEW|TRAIN_START|IMAGES|PROMOTED' ${logPath} 2>/dev/null | tail -20`,
      `echo '---LORA---'`,
      `ls -lh /work/ComfyUI/models/loras/krea2/${slug}_krea2.safetensors 2>/dev/null || true`,
      `echo '---OUTDIR---'`,
      `ls -lh ${outDir}/${slug}_krea2.safetensors 2>/dev/null || ls -1t ${outDir}/*.safetensors 2>/dev/null | head -1 || true`,
      `echo '---PID---'`,
      `PID_FILE=${JSON.stringify(pidPath)}`,
      `if [ -f "$PID_FILE" ]; then`,
      `  RPID=$(cat "$PID_FILE" 2>/dev/null || true)`,
      `  if [ -n "$RPID" ] && kill -0 "$RPID" 2>/dev/null; then`,
      `    CMD=$(tr '\\0' ' ' < /proc/$RPID/cmdline 2>/dev/null || true)`,
      `    case "$CMD" in`,
      `      *krea2_train_network*|*peach_krea2_lora_train*|*musubi_tuner*) echo RUNNING ;;`,
      `      *) echo DEAD ;;`,
      `    esac`,
      `  else echo DEAD; fi`,
      `else`,
      `  if ps -eo args= 2>/dev/null | grep -F "krea2_train_network" | grep -F ${JSON.stringify(slug)} | grep -v grep >/dev/null; then echo RUNNING; else echo DEAD; fi`,
      `fi`,
    ].join("; "),
    120_000,
  );
  const imageCount = Number((out.split("---LOG---")[0] || "").trim().split(/\s+/).pop() || "0");
  const logText = out.includes("---LOG---") ? out.split("---LOG---")[1]?.split("---MARKERS---")[0] || "" : "";
  const markers = out.includes("---MARKERS---") ? out.split("---MARKERS---")[1]?.split("---LORA---")[0] || "" : "";
  const loraSection = out.includes("---LORA---") ? out.split("---LORA---")[1]?.split("---OUTDIR---")[0] || "" : "";
  const outSection = out.includes("---OUTDIR---") ? out.split("---OUTDIR---")[1]?.split("---PID---")[0] || "" : "";
  const pidSection = out.includes("---PID---") ? out.split("---PID---")[1] || "" : "";
  const fullLogHint = `${markers}\n${logText}`;
  const loraInComfy = loraListedInSection(loraSection, slug);
  const hasLoraOutput = loraListedInSection(outSection, slug);
  const markersDone = /TRAIN_DONE|ALL_DONE/.test(markers);
  const failed = /TRAIN_FAIL|NO_LORA|TOO_FEW|Traceback/.test(`${markers}\n${logText}`) && !markersDone;
  // Live process only — never infer RUNNING from log text (stale logs / probe self-match).
  const running = pidSection.includes("RUNNING");
  const trainFinished =
    markersDone || (hasLoraOutput && !running && !failed);
  const done = (loraInComfy || hasLoraOutput) && trainFinished && !running;
  return {
    slug,
    imageCount: Number.isFinite(imageCount) ? imageCount : 0,
    running,
    done,
    failed,
    logPath,
    logText: fullLogHint.trim(),
    loraInComfy,
    hasLoraOutput,
  };
}

async function syncCharacterFromRemoteProbe(
  characterId: string,
  meta: CharacterTrainMeta,
  probe: RemoteTrainProbe,
) {
  const slug = probe.slug;
  const epochs = meta.epochs || 12;
  const loraPath = `krea2/${slug}_krea2.safetensors`;

  if (probe.done) {
    const finished = stampProgress(
      {
        ...meta,
        status: "ready",
        slug,
        trigger: meta.trigger || slug,
        loraPath,
        remoteLog: probe.logPath,
        finishedAt: new Date().toISOString(),
        epochs,
      },
      `${probe.logText}\nTRAIN_DONE\nALL_DONE\nPROMOTED`,
    );
    writeTrainMeta(characterId, finished);
    const updated = await prisma.character.update({
      where: { id: characterId },
      data: {
        loraStatus: "lora_ready",
        loraPath,
        triggerWord: meta.trigger || slug,
        lookbookJson: await lookbookOffForCharacter(characterId),
      },
    });
    void scheduleIdentityPackAfterTrain(updated.userId, characterId).catch((e) =>
      console.error("[peach] identity pack after train:", e),
    );
    void import("@/lib/tg/lora-onboard").then(({ notifyTgLoraTrainingComplete }) =>
      notifyTgLoraTrainingComplete(characterId).catch((e) =>
        console.error("[tg] lora ready notify:", e),
      ),
    );
    return { character: updated, train: finished };
  }

  if (
    probe.hasLoraOutput &&
    !probe.loraInComfy &&
    !probe.running &&
    !probe.failed
  ) {
    try {
      const promoted = await ensureKreaLoraInComfy(slug);
      if (promoted) {
        const rep = await probeRemoteKreaTrain(slug);
        if (rep.done) {
          return syncCharacterFromRemoteProbe(characterId, meta, rep);
        }
      }
    } catch {
      /* keep training state until promote succeeds */
    }
  }

  if (probe.running || probe.done) {
    const progress = stampProgress(
      {
        ...meta,
        status: "training",
        slug,
        trigger: meta.trigger || slug,
        remoteLog: probe.logPath,
        epochs,
        startedAt: meta.startedAt || new Date().toISOString(),
        estimateTotalSec: meta.estimateTotalSec || estimateTrainTotalSec(epochs),
        error: undefined,
        finishedAt: undefined,
        phase: undefined,
      },
      // Only use real remote log — never inject TRAIN_START (fake 40% progress).
      probe.logText || "training…",
    );
    writeTrainMeta(characterId, progress);
    const updated = await prisma.character.update({
      where: { id: characterId },
      data: { loraStatus: "lora_training", triggerWord: meta.trigger || slug },
    });
    return { character: updated, train: progress };
  }

  // Stale "active" log markers without a live process — do not keep training UI alive.
  if (trainLogLooksActive(probe.logText) && !probe.failed && !probe.hasLoraOutput) {
    return null;
  }

  if (probe.failed) {
    const errLine =
      probe.logText
        .split(/\n+/)
        .map((l) => l.trim())
        .filter(Boolean)
        .slice(-1)[0] || "train failed";
    const errored: CharacterTrainMeta = {
      ...meta,
      status: "error",
      slug,
      error: errLine,
      finishedAt: new Date().toISOString(),
      remoteLog: probe.logPath,
      phase: "Ошибка",
      etaSec: 0,
      etaLabel: "остановлено",
      lastLine: errLine,
    };
    writeTrainMeta(characterId, errored);
    const updated = await prisma.character.update({
      where: { id: characterId },
      data: { loraStatus: "lookbook_ready" },
    });
    return { character: updated, train: errored };
  }

  return null;
}

function stampProgress(
  base: CharacterTrainMeta,
  logText: string,
): CharacterTrainMeta {
  const epochs = base.epochs || 12;
  const parsed = parseKreaTrainLog(logText, {
    epochs,
    status: base.status,
  });
  const timed = withTiming(
    parsed,
    base.startedAt,
    base.estimateTotalSec || estimateTrainTotalSec(epochs),
  );
  return {
    ...base,
    phase: timed.phase,
    percent: timed.percent,
    epoch: timed.epoch,
    epochs: timed.epochs || epochs,
    elapsedSec: timed.elapsedSec,
    estimateTotalSec: timed.estimateTotalSec,
    etaSec: timed.etaSec,
    etaLabel: timed.etaLabel,
    lastLine: timed.lastLine || base.lastLine,
  };
}

export async function startKreaLoraTrain(opts: {
  userId: string;
  characterId: string;
  triggerWord?: string;
  epochs?: number;
  /** Skip resume heuristics — always start a fresh remote train. */
  force?: boolean;
}) {
  const character = await prisma.character.findFirst({
    where: { id: opts.characterId, userId: opts.userId },
  });
  if (!character) throw new Error("character not found");

  const photos = listCharacterPhotos(character.id);
  if (photos.length < MIN_PHOTOS) {
    throw new Error(`Нужно минимум ${MIN_PHOTOS} фото (сейчас ${photos.length})`);
  }

  const trigger = sanitizeTrigger(opts.triggerWord || character.triggerWord || character.name);
  const slug = trigger;
  const epochs = Math.min(20, Math.max(4, Math.round(opts.epochs || 12)));
  const estimateTotalSec = estimateTrainTotalSec(epochs);
  const startedAt = new Date().toISOString();

  if (!opts.force && character.loraStatus === "lora_training") {
    const active = readTrainMeta(character.id);
    if (active.status === "uploading" || active.status === "training") {
      try {
        const probe = await probeRemoteKreaTrain(slug);
        // Require a live process or a completed LoRA — never resume on empty/fake logs.
        if ((probe.running && (probe.imageCount > 0 || trainLogLooksActive(probe.logText))) || probe.done) {
          const synced = await syncCharacterFromRemoteProbe(character.id, active, probe);
          if (synced) {
            return {
              trigger,
              slug,
              photoCount: photos.length,
              epochs,
              estimateTotalSec,
              estimateLabel: formatDuration(estimateTotalSec),
              resumed: true,
            };
          }
        }
        // Remote job is dead — allow a clean restart below (no double-charge; status already training).
        console.warn(
          "[peach] stale lora_training with dead remote — restarting",
          character.id,
          slug,
          { running: probe.running, done: probe.done, images: probe.imageCount },
        );
      } catch (e) {
        // SSH flapping — block double-start while we cannot probe
        throw new Error(
          `Не удалось проверить GPU: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
  }

  if (opts.force) {
    writeTrainMeta(character.id, {
      status: "idle",
      trigger,
      slug,
      error: undefined,
    });
  }

  const prevMeta = readTrainMeta(character.id);
  if (!opts.force && (prevMeta.status === "error" || character.loraStatus === "lookbook_ready")) {
    try {
      const probe = await probeRemoteKreaTrain(slug);
      if (probe.running || probe.done) {
        const synced = await syncCharacterFromRemoteProbe(character.id, {
          ...prevMeta,
          trigger,
          slug,
          epochs,
          startedAt: prevMeta.startedAt || startedAt,
          estimateTotalSec,
        }, probe);
        if (synced) {
          return {
            trigger,
            slug,
            photoCount: photos.length,
            epochs,
            estimateTotalSec,
            estimateLabel: formatDuration(estimateTotalSec),
            resumed: true,
          };
        }
      }
    } catch (e) {
      console.warn(
        "[peach] remote train probe before start:",
        e instanceof Error ? e.message : e,
      );
    }
  }

  rewriteCaptions(character.id, trigger);

  writeTrainMeta(
    character.id,
    stampProgress(
      {
        status: "uploading",
        trigger,
        slug,
        epochs,
        startedAt,
        estimateTotalSec,
        phase: "Загрузка фото…",
        percent: 3,
        lastLine: "upload dataset…",
      },
      "uploading",
    ),
  );

  await prisma.character.update({
    where: { id: character.id },
    data: {
      triggerWord: trigger,
      loraStatus: "lora_training",
      photoCount: photos.length,
      loraPath: null,
    },
  });

  // Fire-and-forget: avoid next/server `after()` — on Railway it can skip the job.
  void runKreaLoraTrainBackground({
    characterId: character.id,
    characterName: character.name,
    gender: character.gender === "male" ? "male" : "female",
    trigger,
    slug,
    epochs,
    startedAt,
    estimateTotalSec,
  }).catch((e) => console.error("[peach] krea lora bg:", e));

  return {
    trigger,
    slug,
    photoCount: photos.length,
    epochs,
    estimateTotalSec,
    estimateLabel: formatDuration(estimateTotalSec),
    resumed: false as boolean | undefined,
  };
}

async function runKreaLoraTrainBackground(opts: {
  characterId: string;
  characterName: string;
  gender: "female" | "male";
  trigger: string;
  slug: string;
  epochs: number;
  startedAt: string;
  estimateTotalSec: number;
}) {
  // Lookbook infer is optional and must not block dataset upload / train start.
  void (async () => {
    try {
      const { inferLookbookFromPhotos } = await import("@/lib/lookbook-from-photos");
      const lb = await inferLookbookFromPhotos({
        characterId: opts.characterId,
        gender: opts.gender,
        name: opts.characterName,
      });
      await prisma.character.update({
        where: { id: opts.characterId },
        data: { lookbookJson: JSON.stringify(lb) },
      });
      console.log("[peach] lookbook auto-filled from photos for", opts.characterId);
    } catch (e) {
      console.warn(
        "[peach] lookbook auto-infer skipped:",
        e instanceof Error ? e.message : e,
      );
    }
  })();

  try {
    const { ensureMetalnodeKeyFile } = await import("@/lib/metalnode-ssh");
    ensureMetalnodeKeyFile();
    const check = await metalnodeCheck();
    if (!check.ok) {
      throw new Error(
        `Metalnode SSH недоступен: ${check.detail}. Повтори через минуту или проверь METALNODE_SSH_KEY / порт.`,
      );
    }
    await runTrainPipeline({
      characterId: opts.characterId,
      trigger: opts.trigger,
      slug: opts.slug,
      epochs: opts.epochs,
      startedAt: opts.startedAt,
      estimateTotalSec: opts.estimateTotalSec,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[peach] krea lora train failed:", e);
    const prev = readTrainMeta(opts.characterId);
    writeTrainMeta(opts.characterId, {
      ...prev,
      status: "error",
      trigger: opts.trigger,
      slug: opts.slug,
      error: msg,
      finishedAt: new Date().toISOString(),
      percent: prev.percent || 0,
      phase: "Ошибка",
      etaSec: 0,
      etaLabel: "остановлено",
    });
    await prisma.character.update({
      where: { id: opts.characterId },
      data: { loraStatus: "lookbook_ready" },
    });
    void import("@/lib/ops/errors")
      .then(({ reportOpsError }) =>
        reportOpsError({
          kind: "lora",
          message: msg,
          stack: e instanceof Error ? e.stack : undefined,
          meta: { characterId: opts.characterId },
        }),
      )
      .catch(() => undefined);
  }
}

async function runTrainPipeline(opts: {
  characterId: string;
  trigger: string;
  slug: string;
  epochs: number;
  startedAt: string;
  estimateTotalSec: number;
}) {
  const imgDir = characterImagesDir(opts.characterId);
  const remoteImg = `/work/datasets/${opts.slug}/images`;
  const remoteLog = `/work/loras_out/${opts.slug}_train.log`;
  const remotePid = `/work/loras_out/${opts.slug}_train.pid`;
  const remoteNohup = `/work/loras_out/${opts.slug}_train.nohup`;
  const remoteStart = `/work/bin/peach_start_${opts.slug}.sh`;

  writeTrainMeta(
    opts.characterId,
    stampProgress(
      {
        status: "uploading",
        trigger: opts.trigger,
        slug: opts.slug,
        epochs: opts.epochs,
        startedAt: opts.startedAt,
        estimateTotalSec: opts.estimateTotalSec,
        lastLine: "upload dataset…",
      },
      "uploading",
    ),
  );

  // Preflight: models + musubi must exist before long train
  const pre = await metalnodeSsh(
    [
      "set -e",
      "test -x /work/ai/venv/bin/python",
      "test -x /work/ai/venv/bin/accelerate",
      "test -d /work/train/musubi-tuner",
      "test -f /work/train/musubi-tuner/src/musubi_tuner/krea2_train_network.py",
      "test -f /work/ComfyUI/models/diffusion_models/krea2/krea2_raw_bf16.safetensors",
      "test -f /work/ComfyUI/models/vae/qwen_image_vae.safetensors",
      "( test -f /work/ComfyUI/models/text_encoders/qwen3vl_4b_bf16.safetensors || test -f /work/ComfyUI/models/text_encoders/Huihui-Qwen3-VL-4B-Instruct-abliterated.safetensors )",
      "echo PREFLIGHT_OK",
    ].join(" && "),
    90_000,
  );
  if (!pre.includes("PREFLIGHT_OK")) {
    throw new Error(`preflight failed: ${pre.slice(0, 300)}`);
  }

  const localCount = listCharacterPhotos(opts.characterId).length;
  let remoteCount = 0;
  try {
    const countOut = await metalnodeSsh(
      `find ${JSON.stringify(remoteImg)} -maxdepth 1 -type f \\( -iname '*.png' -o -iname '*.jpg' -o -iname '*.jpeg' -o -iname '*.webp' \\) 2>/dev/null | wc -l`,
      60_000,
    );
    remoteCount = Number((countOut || "").trim().split(/\s+/).pop());
  } catch {
    remoteCount = 0;
  }

  if (Number.isFinite(remoteCount) && remoteCount >= localCount && remoteCount >= MIN_PHOTOS) {
    writeTrainMeta(
      opts.characterId,
      stampProgress(
        {
          status: "uploading",
          trigger: opts.trigger,
          slug: opts.slug,
          epochs: opts.epochs,
          startedAt: opts.startedAt,
          estimateTotalSec: opts.estimateTotalSec,
          lastLine: `датасет уже на сервере (${remoteCount} фото), пропуск upload`,
        },
        "IMAGES",
      ),
    );
  } else {
    await metalnodeSsh(
      `mkdir -p /work/bin /work/loras_out /work/datasets/${opts.slug} && rm -rf ${JSON.stringify(remoteImg)} && mkdir -p ${JSON.stringify(remoteImg)}`,
      60_000,
    );
    await metalnodeScpDirTo(imgDir, remoteImg, 900_000);

    const countOut = await metalnodeSsh(
      `find ${JSON.stringify(remoteImg)} -maxdepth 1 -type f \\( -iname '*.png' -o -iname '*.jpg' -o -iname '*.jpeg' -o -iname '*.webp' \\) | wc -l`,
      60_000,
    );
    remoteCount = Number((countOut || "").trim().split(/\s+/).pop());
    if (!Number.isFinite(remoteCount) || remoteCount < MIN_PHOTOS) {
      throw new Error(`на сервере мало фото после upload: ${remoteCount}`);
    }
  }

  try {
    const probe = await probeRemoteKreaTrain(opts.slug);
    if (probe.running || (trainLogLooksActive(probe.logText) && !probe.done && !probe.failed)) {
      writeTrainMeta(
        opts.characterId,
        stampProgress(
          {
            status: "training",
            trigger: opts.trigger,
            slug: opts.slug,
            epochs: opts.epochs,
            startedAt: opts.startedAt,
            estimateTotalSec: opts.estimateTotalSec,
            remoteLog,
            lastLine: "обучение уже идёт на GPU — подключились к существующему процессу",
          },
          `${probe.logText}\nTRAIN_START`,
        ),
      );
      return;
    }
  } catch {
    /* continue to launch */
  }

  if (!fs.existsSync(SCRIPT_LOCAL)) {
    throw new Error(`train script missing: ${SCRIPT_LOCAL}`);
  }
  const scriptBody = fs
    .readFileSync(SCRIPT_LOCAL, "utf8")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
  const tmpTrain = path.join(characterImagesDir(opts.characterId), "..", "_train.sh");
  fs.writeFileSync(tmpTrain, Buffer.from(scriptBody, "utf8"));
  await metalnodeScpTo(tmpTrain, SCRIPT_REMOTE, 120_000);
  await metalnodeSsh(`chmod +x ${JSON.stringify(SCRIPT_REMOTE)}`, 30_000);

  // Launcher file avoids bash `&;` syntax when chaining over ssh -c
  const startBody = [
    "#!/bin/bash",
    "set -euo pipefail",
    `export PEACH_TRIGGER=${JSON.stringify(opts.trigger)}`,
    `export PEACH_SLUG=${JSON.stringify(opts.slug)}`,
    `export PEACH_EPOCHS=${JSON.stringify(String(opts.epochs))}`,
    "mkdir -p /work/loras_out /work/bin",
    `chmod +x ${JSON.stringify(SCRIPT_REMOTE)}`,
    "# stop previous train for this slug if any",
    `if [ -f ${JSON.stringify(remotePid)} ]; then kill "$(cat ${JSON.stringify(remotePid)})" 2>/dev/null || true; fi`,
    `nohup bash ${JSON.stringify(SCRIPT_REMOTE)} >${JSON.stringify(remoteNohup)} 2>&1 &`,
    `echo $! > ${JSON.stringify(remotePid)}`,
    "sleep 2",
    `PID="$(cat ${JSON.stringify(remotePid)})"`,
    'if kill -0 "$PID" 2>/dev/null; then',
    '  echo "STARTED:$PID"',
    "  exit 0",
    "fi",
    "echo START_FAIL",
    `tail -n 40 ${JSON.stringify(remoteNohup)} 2>/dev/null || true`,
    `tail -n 40 ${JSON.stringify(remoteLog)} 2>/dev/null || true`,
    "exit 1",
    "",
  ].join("\n");

  const tmpStart = path.join(characterImagesDir(opts.characterId), "..", "_start.sh");
  fs.writeFileSync(tmpStart, Buffer.from(startBody, "utf8"));
  await metalnodeScpTo(tmpStart, remoteStart, 60_000);
  await metalnodeSsh(`chmod +x ${JSON.stringify(remoteStart)}`, 30_000);

  writeTrainMeta(
    opts.characterId,
    stampProgress(
      {
        status: "training",
        trigger: opts.trigger,
        slug: opts.slug,
        epochs: opts.epochs,
        startedAt: opts.startedAt,
        estimateTotalSec: opts.estimateTotalSec,
        remoteLog,
        lastLine: "training started…",
      },
      "STOP_COMFY\nIMAGES",
    ),
  );

  const started = await metalnodeSsh(`bash ${JSON.stringify(remoteStart)}`, 120_000);
  if (!started.includes("STARTED:")) {
    throw new Error(`не удалось стартовать train: ${started.slice(0, 500)}`);
  }

  // Catch immediate script failures (missing env, too few images, etc.)
  await new Promise((r) => setTimeout(r, 4000));
  const early = await metalnodeSsh(
    [
      `tail -n 60 ${JSON.stringify(remoteLog)} 2>/dev/null || true`,
      "echo ---NOHUP---",
      `tail -n 40 ${JSON.stringify(remoteNohup)} 2>/dev/null || true`,
      "echo ---PID---",
      `if [ -f ${JSON.stringify(remotePid)} ]; then kill -0 "$(cat ${JSON.stringify(remotePid)})" 2>/dev/null && echo RUNNING || echo DEAD; else echo NOPID; fi`,
    ].join("; "),
    60_000,
  );
  if (/TOO_FEW|PYTHON_MISSING|MUSUBI_MISSING|DIT_MISSING|VAE_MISSING|TE_MISSING|NO_IMAGES|CACHE_LATENTS_FAIL/.test(early)) {
    throw new Error(`train упал сразу: ${early.slice(0, 600)}`);
  }
  if (early.includes("DEAD") && !/CACHE_|TRAIN_START|IMAGES/.test(early)) {
    throw new Error(`train процесс умер сразу: ${early.slice(0, 600)}`);
  }

  writeTrainMeta(
    opts.characterId,
    stampProgress(
      {
        status: "training",
        trigger: opts.trigger,
        slug: opts.slug,
        epochs: opts.epochs,
        startedAt: opts.startedAt,
        estimateTotalSec: opts.estimateTotalSec,
        remoteLog,
        lastLine: "training running…",
      },
      early.includes("CACHE_") || early.includes("IMAGES") ? early : "STOP_COMFY\nIMAGES",
    ),
  );
}

export async function refreshKreaLoraTrainStatus(opts: {
  userId: string;
  characterId: string;
}) {
  const character = await prisma.character.findFirst({
    where: { id: opts.characterId, userId: opts.userId },
  });
  if (!character) throw new Error("character not found");

  const meta = readTrainMeta(character.id);
  const slug = meta.slug || character.triggerWord || "char";
  if (character.loraStatus === "lora_ready" && character.loraPath) {
    try {
      await ensureKreaLoraInComfy(slug);
    } catch {
      /* Comfy may still have the file from a prior promote */
    }
    const ready = stampProgress(
      {
        ...meta,
        status: "ready",
        loraPath: character.loraPath,
        percent: 100,
        phase: "Готово",
        etaSec: 0,
        etaLabel: "готово",
      },
      "TRAIN_DONE\nALL_DONE",
    );
    return { character, train: ready };
  }

  if (
    character.loraStatus !== "lora_training" &&
    meta.status !== "training" &&
    meta.status !== "uploading"
  ) {
    if (meta.status === "error" && slug) {
      try {
        const probe = await probeRemoteKreaTrain(slug);
        if (probe.running || probe.done) {
          const synced = await syncCharacterFromRemoteProbe(character.id, meta, probe);
          if (synced) return synced;
        }
      } catch {
        /* keep local error */
      }
    }
    return { character, train: meta };
  }

  if (meta.status === "uploading") {
    try {
      const probe = await probeRemoteKreaTrain(slug);
      if (probe.running || probe.done) {
        const synced = await syncCharacterFromRemoteProbe(character.id, meta, probe);
        if (synced) return synced;
      }
    } catch {
      /* fall through */
    }
    const uploading = stampProgress({ ...meta, status: "uploading" }, "uploading");
    writeTrainMeta(character.id, uploading);
    return { character, train: uploading };
  }

  const logPath = `/work/loras_out/${slug}_train.log`;

  try {
    const probe = await probeRemoteKreaTrain(slug);
    const synced = await syncCharacterFromRemoteProbe(character.id, meta, probe);
    if (synced) return synced;

    const out = probe.logText + "\n---PID---\n" + (probe.running ? "RUNNING" : "DEAD");

    const done = probe.done;
    const failed = probe.failed;
    const loraPath = `krea2/${slug}_krea2.safetensors`;

    if (done) {
      const finished = stampProgress(
        {
          ...meta,
          status: "ready",
          trigger: meta.trigger || character.triggerWord || slug,
          slug,
          startedAt: meta.startedAt,
          finishedAt: new Date().toISOString(),
          loraPath,
          remoteLog: logPath,
          epochs: meta.epochs || 12,
        },
        "TRAIN_DONE\nALL_DONE\nPROMOTED",
      );
      writeTrainMeta(character.id, finished);
    const updated = await prisma.character.update({
      where: { id: character.id },
      data: {
        loraStatus: "lora_ready",
        loraPath,
        triggerWord: meta.trigger || character.triggerWord || slug,
        lookbookJson: await lookbookOffForCharacter(character.id),
      },
    });
    void scheduleIdentityPackAfterTrain(updated.userId, character.id).catch((e) =>
      console.error("[peach] identity pack after train:", e),
    );
    void import("@/lib/tg/lora-onboard").then(({ notifyTgLoraTrainingComplete }) =>
      notifyTgLoraTrainingComplete(character.id).catch((e) =>
        console.error("[tg] lora ready notify:", e),
      ),
    );
    return { character: updated, train: finished };
    }

    if (failed || (out.includes("DEAD") && !probe.loraInComfy && !probe.running && meta.startedAt)) {
      const started = meta.startedAt ? Date.parse(meta.startedAt) : 0;
      const longEnough = Date.now() - started > 5 * 60_000;
      if (failed || longEnough) {
        const errLine =
          out
            .split(/\n+/)
            .map((l) => l.trim())
            .filter((l) => l && !l.startsWith("---"))
            .slice(-1)[0] || "train failed";
        const errored: CharacterTrainMeta = {
          ...meta,
          status: "error",
          finishedAt: new Date().toISOString(),
          error: errLine,
          lastLine: errLine,
          remoteLog: logPath,
          phase: "Ошибка",
          etaSec: 0,
          etaLabel: "остановлено",
        };
        writeTrainMeta(character.id, errored);
        const updated = await prisma.character.update({
          where: { id: character.id },
          data: { loraStatus: "lookbook_ready" },
        });
        return { character: updated, train: errored };
      }
    }

    const progress = stampProgress(
      {
        ...meta,
        status: "training",
        remoteLog: logPath,
        epochs: meta.epochs || 12,
      },
      out,
    );
    writeTrainMeta(character.id, progress);
    return { character, train: progress };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const fallback = stampProgress(
      { ...meta, lastLine: `status check: ${msg}` },
      (meta.status as string) === "uploading" ? "uploading" : "",
    );
    return { character, train: fallback };
  }
}
