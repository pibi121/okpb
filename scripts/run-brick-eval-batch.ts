/**
 * Brick eval Ref2V batch (actions / combo camera+voice).
 *
 *   npx tsx scripts/run-brick-eval-batch.ts --kind=actions
 *   npx tsx scripts/run-brick-eval-batch.ts --kind=combo --resume
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

const kindArg =
  process.argv.find((a) => a.startsWith("--kind="))?.split("=")[1] || "actions";
const KIND = kindArg === "combo" ? "combo" : "actions";
const RESUME = process.argv.includes("--resume");
const RETRY_ERRORS = process.argv.includes("--retry-errors");
const PENIS_REF_PATH = path.join(ROOT, "data", "refs", "penis-reference.png");

const PATHS = {
  actions: {
    prompts: path.join(ROOT, "data", "action-eval-prompts-batch1.json"),
    clips: path.join(ROOT, "data", "action-eval-clips-batch1.json"),
    log: path.join(ROOT, "data", "logs", "action-eval-batch1.log"),
    prefix: "peach/action-eval",
  },
  combo: {
    prompts: path.join(ROOT, "data", "combo-eval-prompts-v1.json"),
    clips: path.join(ROOT, "data", "combo-eval-clips-v1.json"),
    log: path.join(ROOT, "data", "logs", "combo-eval-v1.log"),
    prefix: "peach/combo-eval",
  },
}[KIND];

const VARIANTS_PER_ITEM = 2;

type BrickItem = {
  id: string;
  title: string;
  brick: string;
  body: string;
  picture4Penis?: boolean;
  evalType?: string;
  evalHintRu?: string;
  bricks?: Array<{
    category: string;
    categoryLabelRu?: string;
    id: string;
    title: string;
  }>;
  ratingCategories?: Array<{ key: string; labelRu: string }>;
  comboType?: string;
};

type ClipRecord = {
  id: string;
  itemId: string;
  itemTitle: string;
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
  evalType?: string;
  evalHintRu?: string;
  bricks?: BrickItem["bricks"];
  ratingCategories?: BrickItem["ratingCategories"];
  comboType?: string;
  /** @deprecated alias for itemId */
  poseId?: string;
};

type ClipsDoc = {
  batchId: string;
  batchLabel?: string;
  evalType?: string;
  startedAt: string | null;
  finishedAt: string | null;
  status: string;
  totalExpected: number;
  refSourceRunId: string;
  characterName: string;
  clips: ClipRecord[];
};

function log(msg: string) {
  const line = `[${KIND}-eval] ${new Date().toISOString()} ${msg}`;
  console.log(line);
  fs.mkdirSync(path.dirname(PATHS.log), { recursive: true });
  fs.appendFileSync(PATHS.log, line + "\n", "utf8");
}

function readClipsDoc(): ClipsDoc {
  if (!fs.existsSync(PATHS.clips)) {
    return {
      batchId: `${KIND}-eval-v1`,
      startedAt: null,
      finishedAt: null,
      status: "pending",
      totalExpected: 0,
      refSourceRunId: "",
      characterName: "",
      clips: [],
    };
  }
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

async function loadRefs(prisma: PrismaClient, runId: string) {
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

  const slots: QuickVideoImageSlot[] = [1, 2, 3].map((n) => ({
    kind: "identity" as const,
    role: "identity" as const,
    characterName: "Daisy Shtorm",
    label: "Daisy Shtorm",
    pictureIndex: n,
  }));

  log(`refs from ${runId}: ${urls.join(", ")}`);
  return { buffers, slots, userId: run.userId };
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
    evalType?: string;
    items: BrickItem[];
  };

  const prisma = new PrismaClient();
  const doc = readClipsDoc();
  const durationSec = promptsDoc.durationSec || 5;
  const size = minimaxOutputSize(
    (promptsDoc.orientation || "9_16") as "9_16",
  );

  if (!RESUME || doc.clips.length === 0) {
    doc.batchId = `${KIND}-eval-v1`;
    doc.startedAt = new Date().toISOString();
    doc.finishedAt = null;
    doc.status = "running";
    doc.batchLabel = promptsDoc.batchLabel || `${KIND}-eval`;
    doc.evalType = promptsDoc.evalType || KIND;
    doc.totalExpected = promptsDoc.items.length * VARIANTS_PER_ITEM;
    doc.refSourceRunId = promptsDoc.refSourceRunId;
    doc.characterName = promptsDoc.characterName;
    doc.clips = [];
    for (const item of promptsDoc.items) {
      for (let v = 1; v <= VARIANTS_PER_ITEM; v++) {
        doc.clips.push({
          id: `${item.id}_v${v}`,
          itemId: item.id,
          poseId: item.id,
          itemTitle: item.title,
          brick: item.brick,
          variant: v as 1 | 2,
          url: "",
          status: "pending",
          durationSec,
          genSec: null,
          engine: null,
          error: null,
          attempts: 0,
          evalType: item.evalType || KIND,
          evalHintRu: item.evalHintRu,
          bricks: item.bricks,
          ratingCategories: item.ratingCategories,
          comboType: item.comboType,
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
    log("resume" + (RETRY_ERRORS ? " + retry-errors" : ""));
  }

  const daisy = await prisma.character.findFirst({
    where: { name: { contains: "Daisy" } },
  });
  if (!daisy) throw new Error("Daisy Shtorm not found");

  const { buffers: baseBuffers, slots: baseSlots, userId } = await loadRefs(
    prisma,
    promptsDoc.refSourceRunId,
  );

  const penisBuffer = fs.existsSync(PENIS_REF_PATH)
    ? fs.readFileSync(PENIS_REF_PATH)
    : null;
  const penisSlot: QuickVideoImageSlot = {
    kind: "anatomy",
    role: "anatomy",
    label: "Erect penis anatomy reference (shaft, glans, proportions)",
    pictureIndex: 4,
  };

  let done = 0;
  let errors = 0;

  for (const item of promptsDoc.items) {
    const usePenisRef = Boolean(penisBuffer) && Boolean(item.picture4Penis);
    const buffers = usePenisRef
      ? [...baseBuffers, penisBuffer!]
      : baseBuffers;
    const slots = usePenisRef ? [...baseSlots, penisSlot] : baseSlots;
    const composed = composeQuickVideoPrompt(
      promptBodyForModel(item.body, item.brick),
      slots,
    );

    for (let v = 1; v <= VARIANTS_PER_ITEM; v++) {
      const clipId = `${item.id}_v${v}`;
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

      doc.clips[idx] = {
        ...existing,
        status: "running",
        startedAt: new Date().toISOString(),
        error: null,
        attempts: (existing.attempts || 0) + 1,
      };
      writeClipsDoc(doc);

      const t0 = Date.now();
      log(`START ${clipId} · ${item.title} · v${v}`);

      try {
        const out = await runRef2VClip({
          refImageBuffers: buffers,
          prompt: composed,
          width: size.width,
          height: size.height,
          durationSec,
          filenamePrefix: `${PATHS.prefix}/${item.id}/v${v}`,
        });

        const saved = saveGalleryBinary(
          userId || daisy.userId,
          "mp4",
          out.bytes,
          `${KIND}_${item.id}_v${v}`,
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
    `FINISHED ready=${readyCount}/${doc.totalExpected} errors=${errCount} this_run=${done}`,
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
