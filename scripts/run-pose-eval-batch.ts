/**
 * Pose-eval Ref2V batch (5s × 2 variants per pose).
 *
 *   npx tsx scripts/run-pose-eval-batch.ts --batch=1
 *   npx tsx scripts/run-pose-eval-batch.ts --batch=2 --resume
 *   npx tsx scripts/run-pose-eval-batch.ts --batch=2 --retry-errors
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import {
  composeQuickVideoPrompt,
  promptBodyForModel,
  type QuickVideoImageSlot,
} from "../src/lib/quick-video-prompt";
import { localBytesFromResultUrl, runRef2VClip } from "../src/lib/peach-lab";
import { saveGalleryBinary } from "../src/lib/local-store";
import { minimaxOutputSize } from "../src/lib/video-orientation";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const batchArg =
  process.argv.find((a) => a.startsWith("--batch="))?.split("=")[1] || "1";
const BATCH =
  batchArg === "5"
    ? "5"
    : batchArg === "4"
      ? "4"
      : batchArg === "3"
        ? "3"
        : batchArg === "2"
          ? "2"
          : "1";
const RESUME = process.argv.includes("--resume");
const RETRY_ERRORS = process.argv.includes("--retry-errors");
const PENIS_REF_GLOBAL = process.argv.includes("--penis-ref");
const PENIS_REF_PATH = path.join(ROOT, "data", "refs", "penis-reference.png");
const PENIS_REF_POSES_PATH = path.join(
  ROOT,
  "data",
  "pose-eval-corrections-for-ai.json",
);

const PATHS = {
  "1": {
    prompts: path.join(ROOT, "data", "pose-eval-prompts.json"),
    clips: path.join(ROOT, "data", "pose-eval-clips.json"),
    log: path.join(ROOT, "data", "logs", "pose-eval-batch1.log"),
  },
  "2": {
    prompts: path.join(ROOT, "data", "pose-eval-prompts-batch2.json"),
    clips: path.join(ROOT, "data", "pose-eval-clips-batch2.json"),
    log: path.join(ROOT, "data", "logs", "pose-eval-batch2.log"),
  },
  "3": {
    prompts: path.join(ROOT, "data", "pose-eval-prompts-batch3-picture4-test.json"),
    clips: path.join(ROOT, "data", "pose-eval-clips-batch3.json"),
    log: path.join(ROOT, "data", "logs", "pose-eval-batch3.log"),
  },
  "4": {
    prompts: path.join(ROOT, "data", "pose-eval-prompts-batch4.json"),
    clips: path.join(ROOT, "data", "pose-eval-clips-batch4.json"),
    log: path.join(ROOT, "data", "logs", "pose-eval-batch4.log"),
  },
  "5": {
    prompts: path.join(ROOT, "data", "pose-eval-prompts-batch5.json"),
    clips: path.join(ROOT, "data", "pose-eval-clips-batch5.json"),
    log: path.join(ROOT, "data", "logs", "pose-eval-batch5.log"),
  },
}[BATCH];

const VARIANTS_PER_POSE = 2;

type PoseDef = {
  id: string;
  title: string;
  brick: string;
  body: string;
  picture4Penis?: boolean;
};

type ClipRecord = {
  id: string;
  poseId: string;
  poseTitle: string;
  brick: string;
  variant: 1 | 2;
  url: string;
  status: "pending" | "running" | "ready" | "error";
  durationSec: number | null;
  genSec: number | null;
  engine: string | null;
  error?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  attempts?: number;
};

type ClipsDoc = {
  batchId: string;
  batchLabel?: string;
  startedAt: string | null;
  finishedAt: string | null;
  status: string;
  totalExpected: number;
  refSourceRunId: string;
  characterName: string;
  clips: ClipRecord[];
};

function log(msg: string) {
  const line = `[batch${BATCH}] ${new Date().toISOString()} ${msg}`;
  console.log(line);
  fs.mkdirSync(path.dirname(PATHS.log), { recursive: true });
  fs.appendFileSync(PATHS.log, line + "\n", "utf8");
}

function readClipsDoc(): ClipsDoc {
  return JSON.parse(fs.readFileSync(PATHS.clips, "utf8")) as ClipsDoc;
}

function writeClipsDoc(doc: ClipsDoc) {
  fs.writeFileSync(PATHS.clips, JSON.stringify(doc, null, 2), "utf8");
}

function parseJsonArray(raw: string): string[] {
  try {
    const j = JSON.parse(raw);
    return Array.isArray(j) ? j.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

async function loadRefs(
  prisma: PrismaClient,
  runId: string,
  userId: string,
  opts?: { penisRef?: boolean },
) {
  const run = await prisma.quickVideoRun.findUnique({ where: { id: runId } });
  if (!run) throw new Error(`ref source run not found: ${runId}`);

  const urls = parseJsonArray(run.refImageUrlsJson).slice(0, 3);
  if (urls.length < 3) throw new Error(`need 3 ref urls, got ${urls.length}`);

  const buffers: Buffer[] = [];
  for (const url of urls) {
    const b = localBytesFromResultUrl(url);
    if (!b?.length) throw new Error(`ref missing on disk: ${url}`);
    buffers.push(b);
  }

  const slots: QuickVideoImageSlot[] = [
    {
      kind: "identity",
      role: "identity",
      characterName: "Daisy Shtorm",
      label: "Daisy Shtorm",
      pictureIndex: 1,
    },
    {
      kind: "identity",
      role: "identity",
      characterName: "Daisy Shtorm",
      label: "Daisy Shtorm",
      pictureIndex: 2,
    },
    {
      kind: "identity",
      role: "identity",
      characterName: "Daisy Shtorm",
      label: "Daisy Shtorm",
      pictureIndex: 3,
    },
  ];

  if (opts?.penisRef) {
    if (!fs.existsSync(PENIS_REF_PATH)) {
      throw new Error(`penis ref missing: ${PENIS_REF_PATH}`);
    }
    buffers.push(fs.readFileSync(PENIS_REF_PATH));
    slots.push({
      kind: "anatomy",
      role: "anatomy",
      label: "Erect penis anatomy reference (shaft, glans, proportions)",
      pictureIndex: 4,
    });
    log(`penis ref: ${PENIS_REF_PATH}`);
  }

  log(`refs from ${runId}: ${urls.join(", ")}`);
  return { buffers, slots, userId: run.userId || userId };
}

function loadPenisRefPoseIds(): Set<string> {
  if (PENIS_REF_GLOBAL) return new Set(["*"]);
  try {
    const doc = JSON.parse(fs.readFileSync(PENIS_REF_POSES_PATH, "utf8")) as {
      penisRefTest?: { poseIds?: string[] };
    };
    return new Set(doc.penisRefTest?.poseIds || []);
  } catch {
    return new Set();
  }
}

async function main() {
  const promptsDoc = JSON.parse(
    fs.readFileSync(PATHS.prompts, "utf8"),
  ) as {
    durationSec: number;
    orientation: string;
    refSourceRunId: string;
    characterName: string;
    batchLabel?: string;
    poses: PoseDef[];
  };

  const prisma = new PrismaClient();
  const doc = readClipsDoc();
  const durationSec = promptsDoc.durationSec || 5;
  const size = minimaxOutputSize(
    (promptsDoc.orientation || "9_16") as "9_16",
  );

  if (!RESUME || doc.clips.length === 0) {
    doc.startedAt = new Date().toISOString();
    doc.finishedAt = null;
    doc.status = "running";
    doc.batchLabel = promptsDoc.batchLabel || `batch${BATCH}`;
    doc.totalExpected = promptsDoc.poses.length * VARIANTS_PER_POSE;
    doc.refSourceRunId = promptsDoc.refSourceRunId;
    doc.characterName = promptsDoc.characterName;
    doc.clips = [];
    for (const pose of promptsDoc.poses) {
      for (let v = 1; v <= VARIANTS_PER_POSE; v++) {
        doc.clips.push({
          id: `${pose.id}_v${v}`,
          poseId: pose.id,
          poseTitle: pose.title,
          brick: pose.brick,
          variant: v as 1 | 2,
          url: "",
          status: "pending",
          durationSec,
          genSec: null,
          engine: null,
          error: null,
          attempts: 0,
        });
      }
    }
    writeClipsDoc(doc);
  } else {
    doc.status = "running";
    if (RETRY_ERRORS) {
      for (const c of doc.clips) {
        if (c.status === "error" && (c.attempts || 0) < 3) {
          c.status = "pending";
          c.error = null;
        }
      }
    }
    writeClipsDoc(doc);
    log("resume mode" + (RETRY_ERRORS ? " + retry-errors" : ""));
  }

  const daisy = await prisma.character.findFirst({
    where: { name: { contains: "Daisy" } },
  });
  if (!daisy) throw new Error("Daisy Shtorm not found");

  const { buffers: baseBuffers, slots: baseSlots } = await loadRefs(
    prisma,
    promptsDoc.refSourceRunId,
    daisy.userId,
  );
  const penisRefPoses = loadPenisRefPoseIds();
  const penisBuffer = fs.existsSync(PENIS_REF_PATH)
    ? fs.readFileSync(PENIS_REF_PATH)
    : null;
  if ((BATCH === "3" || BATCH === "4") && !penisBuffer) {
    throw new Error(`batch${BATCH} requires penis ref at ${PENIS_REF_PATH}`);
  }
  const penisSlot: QuickVideoImageSlot = {
    kind: "anatomy",
    role: "anatomy",
    label: "Erect penis anatomy reference (shaft, glans, proportions)",
    pictureIndex: 4,
  };

  let done = 0;
  let errors = 0;

  for (const pose of promptsDoc.poses) {
    const usePenisRef =
      Boolean(penisBuffer) &&
      (BATCH === "3" ||
        (BATCH === "4" && Boolean((pose as PoseDef).picture4Penis)) ||
        penisRefPoses.has("*") ||
        penisRefPoses.has(pose.id));
    const buffers = usePenisRef
      ? [...baseBuffers, penisBuffer!]
      : baseBuffers;
    const slots = usePenisRef ? [...baseSlots, penisSlot] : baseSlots;
    const composedBase = composeQuickVideoPrompt(
      promptBodyForModel(pose.body, pose.brick),
      slots,
    );

    for (let v = 1; v <= VARIANTS_PER_POSE; v++) {
      const clipId = `${pose.id}_v${v}`;
      const idx = doc.clips.findIndex((c) => c.id === clipId);
      if (idx < 0) continue;

      const existing = doc.clips[idx];
      if (existing.status === "ready" && existing.url) {
        done += 1;
        continue;
      }
      if (existing.status === "error" && !RETRY_ERRORS) {
        errors += 1;
        continue;
      }
      if (existing.status !== "pending" && existing.status !== "error") {
        if (existing.status === "running") {
          existing.status = "pending";
        }
      }

      doc.clips[idx] = {
        ...existing,
        status: "running",
        startedAt: new Date().toISOString(),
        error: null,
        attempts: (existing.attempts || 0) + 1,
      };
      writeClipsDoc(doc);

      const t0 = Date.now();
      log(`START ${clipId} · ${pose.title} · v${v}`);

      try {
        const out = await runRef2VClip({
          refImageBuffers: buffers,
          prompt: composedBase,
          width: size.width,
          height: size.height,
          durationSec,
          filenamePrefix: `peach/pose-eval2/${pose.id}/v${v}`,
        });

        const saved = saveGalleryBinary(
          daisy.userId,
          "mp4",
          out.bytes,
          `pose2_${pose.id}_v${v}`,
        );

        const genSec = Math.round((Date.now() - t0) / 1000);
        doc.clips[idx] = {
          ...doc.clips[idx],
          status: "ready",
          url: saved.publicUrl,
          genSec,
          engine: out.engine,
          finishedAt: new Date().toISOString(),
          error: null,
        };
        done += 1;
        log(`READY ${clipId} genSec=${genSec}`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        doc.clips[idx] = {
          ...doc.clips[idx],
          status: "error",
          error: msg.slice(0, 500),
          genSec: Math.round((Date.now() - t0) / 1000),
          finishedAt: new Date().toISOString(),
        };
        errors += 1;
        log(`ERROR ${clipId}: ${msg.slice(0, 280)}`);
      }

      writeClipsDoc(doc);
    }
  }

  const readyCount = doc.clips.filter((c) => c.status === "ready").length;
  const errCount = doc.clips.filter((c) => c.status === "error").length;
  doc.status =
    readyCount >= doc.totalExpected
      ? "done"
      : errCount > 0 && readyCount === 0
        ? "error"
        : "partial";
  doc.finishedAt = new Date().toISOString();
  writeClipsDoc(doc);

  log(
    `FINISHED ready=${readyCount}/${doc.totalExpected} errors=${errCount} this_run_done=${done}`,
  );
  await prisma.$disconnect();

  if (readyCount < doc.totalExpected && errCount > 0) {
    process.exit(2);
  }
}

main().catch((e) => {
  log(`FATAL ${e instanceof Error ? e.message : String(e)}`);
  console.error(e);
  process.exit(1);
});
