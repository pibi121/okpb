/**
 * Gallery «Оживить» I2V A/B: stock FL2VA vs Eros Max BF16 × ±furry e31.
 * Waits for Comfy queue idle (does not kill park/classroom sweeps).
 *
 *   npx tsx --env-file=.env scripts/run-animate-gallery-ab.ts [stillId]
 */
import { PrismaClient } from "@prisma/client";
import {
  localBytesFromResultUrl,
  runI2VFromStill,
} from "../src/lib/peach-lab";
import { backupDatabase, saveGalleryBinary } from "../src/lib/local-store";
import { resolveSexLoraPack } from "../src/lib/sex-loras";
import type { MinimaxBaseId } from "../src/lib/minimax-base";
import type { MinimaxLoraSpec } from "../src/lib/anatomy-loras";
import { composeVideoPromptLLM } from "../src/lib/prompt-composer-llm";
import { ollamaUnload } from "../src/lib/ollama-client";
import { ensureComfyReady } from "../src/lib/comfy-client";

const STILL_ID_ARG = process.argv[2] || "";
const DURATION_SEC = 6;
const CIVIT = {
  steps: 6,
  samplerName: "er_sde",
  schedulerName: "simple",
} as const;

type Variant = {
  id: string;
  title: string;
  minimaxBase: MinimaxBaseId | null;
  loras: MinimaxLoraSpec[];
  triggers: string[];
  engineSuffix: string;
  steps?: number;
  samplerName?: string;
  schedulerName?: string;
};

const prisma = new PrismaClient();

async function waitForComfyIdle(label: string) {
  console.log(`[wait] ${label} — until Comfy queue empty…`);
  for (let i = 0; i < 240; i++) {
    await ensureComfyReady(5, 1500);
    const res = await fetch("http://127.0.0.1:8188/queue");
    if (!res.ok) {
      await new Promise((r) => setTimeout(r, 5000));
      continue;
    }
    const q = (await res.json()) as {
      queue_running?: unknown[];
      queue_pending?: unknown[];
    };
    const running = q.queue_running?.length || 0;
    const pending = q.queue_pending?.length || 0;
    if (running === 0 && pending === 0) {
      console.log(`[wait] idle after ${i} polls`);
      return;
    }
    if (i % 6 === 0) {
      console.log(`[wait] running=${running} pending=${pending}`);
    }
    await new Promise((r) => setTimeout(r, 10_000));
  }
  throw new Error("Comfy still busy after ~40 min");
}

function variants(): Variant[] {
  const furry = resolveSexLoraPack("furry_nsfw");
  // Fair 2×2: same Civit sampling (er_sde / simple / 6) as recent eros winners.
  return [
    {
      id: "stock",
      title: "Оживление A/B · 1 stock FL2VA er_sde/6",
      minimaxBase: null,
      loras: [],
      triggers: [],
      engineSuffix: "",
      ...CIVIT,
    },
    {
      id: "stock+furry",
      title: "Оживление A/B · 2 stock FL2VA + furry e31 er_sde/6",
      minimaxBase: null,
      loras: furry.loras,
      triggers: furry.triggers,
      engineSuffix: furry.engineSuffix,
      ...CIVIT,
    },
    {
      id: "eros",
      title: "Оживление A/B · 3 Eros Max BF16 er_sde/6",
      minimaxBase: "eros_max",
      loras: [],
      triggers: [],
      engineSuffix: "",
      ...CIVIT,
    },
    {
      id: "eros+furry",
      title: "Оживление A/B · 4 Eros Max BF16 + furry e31 er_sde/6",
      minimaxBase: "eros_max",
      loras: furry.loras,
      triggers: furry.triggers,
      engineSuffix: furry.engineSuffix,
      ...CIVIT,
    },
  ];
}

async function main() {
  let still = STILL_ID_ARG
    ? await prisma.galleryItem.findFirst({
        where: { id: STILL_ID_ARG, kind: "photo" },
      })
    : null;

  if (!still) {
    still = await prisma.galleryItem.findFirst({
      where: { kind: "photo", resultUrl: { not: "" } },
      orderBy: { createdAt: "desc" },
    });
  }
  if (!still?.resultUrl) throw new Error("no gallery still found");

  const stillBytes = localBytesFromResultUrl(still.resultUrl);
  if (!stillBytes?.length) {
    throw new Error(`still bytes missing: ${still.resultUrl}`);
  }

  console.log(
    JSON.stringify(
      {
        stillId: still.id,
        title: still.title,
        url: still.resultUrl,
        wh: [still.width, still.height],
        variants: variants().map((v) => v.id),
      },
      null,
      2,
    ),
  );

  await waitForComfyIdle("park/other GPU jobs");

  const plot = "subtle natural motion matching the still pose, soft breathing, slight head movement, keep identity and framing locked";
  let videoPrompt: string;
  try {
    videoPrompt = await composeVideoPromptLLM({
      stillPrompt: still.prompt || "",
      userNote: plot,
      stillTitle: still.title || "",
      durationSec: DURATION_SEC,
    });
  } catch (e) {
    console.warn("[prompt] LLM failed, using fallback:", e);
    videoPrompt = `[Shot 1] ${plot}. Preserve face, body, clothing, and background exactly as in Picture 1.`;
  }
  await ollamaUnload().catch(() => undefined);

  const results: Array<Record<string, unknown>> = [];

  for (const v of variants()) {
    await waitForComfyIdle(`before ${v.id}`);
    console.log("\n=== START", v.title, "===");
    const pending = await prisma.galleryItem.create({
      data: {
        userId: still.userId,
        characterId: still.characterId,
        kind: "video",
        title: v.title,
        prompt: videoPrompt,
        sourceUrl: still.resultUrl,
        resultUrl: "",
        width: still.width,
        height: still.height,
        metaJson: JSON.stringify({
          status: "busy",
          jobAction: "animate_ab",
          stillId: still.id,
          variantId: v.id,
        }),
      },
    });

    try {
      const out = await runI2VFromStill({
        stillBytes,
        prompt: videoPrompt,
        width: still.width || 888,
        height: still.height || 1176,
        filenamePrefix: `peach/animate-ab/${v.id}_${pending.id}`,
        durationSec: DURATION_SEC,
        lorasOverride: v.loras,
        extraTriggers: v.triggers,
        engineSuffixOverride: v.engineSuffix,
        minimaxBase: v.minimaxBase,
        steps: v.steps,
        samplerName: v.samplerName,
        schedulerName: v.schedulerName,
        extraHints: [still.prompt, still.title, plot],
      });

      const saved = saveGalleryBinary(
        still.userId,
        "mp4",
        out.bytes,
        `animate_ab_${pending.id}`,
      );
      await prisma.galleryItem.update({
        where: { id: pending.id },
        data: {
          resultUrl: saved.publicUrl,
          width: out.size.width,
          height: out.size.height,
          prompt: out.prompt,
          metaJson: JSON.stringify({
            status: "ready",
            jobAction: "animate_ab",
            stillId: still.id,
            variantId: v.id,
            engine: out.engine,
            unetName: out.unetName,
            baseId: out.baseId,
            localKey: saved.relKey,
            civit: v.steps ? CIVIT : null,
            loras: v.loras,
          }),
        },
      });
      backupDatabase("animate-gallery-ab");
      const row = {
        id: pending.id,
        variant: v.id,
        title: v.title,
        status: "ready",
        engine: out.engine,
        url: saved.publicUrl,
      };
      results.push(row);
      console.log("READY", JSON.stringify(row));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("FAIL", v.id, msg);
      await prisma.galleryItem.update({
        where: { id: pending.id },
        data: {
          metaJson: JSON.stringify({
            status: "error",
            jobAction: "animate_ab",
            stillId: still.id,
            variantId: v.id,
            error: msg.slice(0, 2000),
          }),
        },
      });
      results.push({
        id: pending.id,
        variant: v.id,
        title: v.title,
        status: "error",
        error: msg.slice(0, 400),
      });
    }
  }

  console.log("\n=== SUMMARY ===");
  console.log(JSON.stringify({ stillId: still.id, results }, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
