/**
 * Eros Max BF16 vs INT8 with Civit beta3 recommended sampling:
 *   sampler er_sde, scheduler simple, 6 steps, Ref2V path.
 *
 *   npx tsx scripts/run-eros-civit-ab.ts [sourceRunId]
 *
 * Default source: classroom LoRA A/B2 baseline.
 */
import { PrismaClient } from "@prisma/client";
import { localBytesFromResultUrl, runRef2VClip } from "../src/lib/peach-lab";
import { backupDatabase, saveGalleryBinary } from "../src/lib/local-store";
import type { MinimaxBaseId } from "../src/lib/minimax-base";

const SOURCE_RUN_ID = process.argv[2] || "cmt8og8bl0009v9iwr2hcna3j";
const SCENE_TAG = process.argv[3] || "classroom";
const TITLE_PREFIX = "Eros Civit";

const CIVIT = {
  steps: 6,
  samplerName: "er_sde",
  schedulerName: "simple",
} as const;

type Variant = {
  id: string;
  title: string;
  minimaxBase: MinimaxBaseId;
};

const VARIANTS: Variant[] = [
  {
    id: "bf16",
    title: `${TITLE_PREFIX} · BF16 er_sde/6 (${SCENE_TAG})`,
    minimaxBase: "eros_max",
  },
  {
    id: "int8",
    title: `${TITLE_PREFIX} · INT8 er_sde/6 (${SCENE_TAG})`,
    minimaxBase: "eros_max_int8",
  },
];

const prisma = new PrismaClient();

function parseJsonArray(raw: string): string[] {
  try {
    const j = JSON.parse(raw);
    return Array.isArray(j) ? j.filter((x: unknown) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

async function main() {
  const source = await prisma.quickVideoRun.findUnique({
    where: { id: SOURCE_RUN_ID },
  });
  if (!source) throw new Error(`source not found: ${SOURCE_RUN_ID}`);

  const refUrls = parseJsonArray(source.refImageUrlsJson);
  const refBuffers: Buffer[] = [];
  for (const url of refUrls) {
    const b = localBytesFromResultUrl(url);
    if (!b?.length) throw new Error(`missing ref: ${url}`);
    refBuffers.push(b);
  }

  let refVideoBuffer: Buffer | null = null;
  let refVideoName: string | undefined;
  if (source.refVideoUrl) {
    refVideoBuffer = localBytesFromResultUrl(source.refVideoUrl);
    refVideoName = source.refVideoUrl.split("/").pop() || "pose.mp4";
  }

  const composed = source.composedPrompt || source.prompt;
  console.log(
    JSON.stringify(
      {
        sourceId: source.id,
        title: source.title,
        durationSec: source.durationSec,
        size: `${source.width}x${source.height}`,
        refs: refBuffers.length,
        hasRefVideo: Boolean(refVideoBuffer?.length),
        civit: CIVIT,
        variants: VARIANTS.map((v) => v.id),
      },
      null,
      2,
    ),
  );

  for (const v of VARIANTS) {
    console.log("\n=== START", v.title, "===");
    const run = await prisma.quickVideoRun.create({
      data: {
        userId: source.userId,
        title: v.title,
        prompt: source.prompt,
        composedPrompt: composed,
        characterIdsJson: source.characterIdsJson,
        refImageUrlsJson: source.refImageUrlsJson,
        refVideoUrl: source.refVideoUrl || "",
        refSlotsJson: source.refSlotsJson,
        orientation: source.orientation,
        durationSec: source.durationSec,
        width: source.width,
        height: source.height,
        status: "busy",
      },
    });

    try {
      const out = await runRef2VClip({
        refImageBuffers: refBuffers,
        refVideoBuffer,
        refVideoName,
        prompt: composed,
        width: source.width,
        height: source.height,
        durationSec: source.durationSec,
        filenamePrefix: `peach/eros-civit/${v.id}_${run.id}`,
        lorasOverride: [],
        extraTriggers: [],
        engineSuffixOverride: `eros-civit-${v.id}`,
        minimaxBase: v.minimaxBase,
        steps: CIVIT.steps,
        samplerName: CIVIT.samplerName,
        schedulerName: CIVIT.schedulerName,
      });

      const saved = saveGalleryBinary(
        source.userId,
        "mp4",
        out.bytes,
        `quick_${run.id}`,
      );
      const item = await prisma.galleryItem.create({
        data: {
          userId: source.userId,
          kind: "video",
          title: v.title,
          prompt: out.prompt,
          resultUrl: saved.publicUrl,
          width: out.size.width,
          height: out.size.height,
          metaJson: JSON.stringify({
            status: "ready",
            engine: out.engine,
            quickVideoRunId: run.id,
            erosCivitVariant: v.id,
            minimaxBase: v.minimaxBase,
            civit: CIVIT,
            sourceQuickVideoRunId: SOURCE_RUN_ID,
          }),
        },
      });
      await prisma.quickVideoRun.update({
        where: { id: run.id },
        data: {
          status: "ready",
          resultVideoUrl: saved.publicUrl,
          galleryItemId: item.id,
          width: out.size.width,
          height: out.size.height,
          engine: out.engine,
          composedPrompt: out.prompt,
          error: null,
        },
      });
      backupDatabase("eros-civit-ab");
      console.log("READY", run.id, out.engine, saved.publicUrl);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("FAIL", v.id, msg);
      await prisma.quickVideoRun.update({
        where: { id: run.id },
        data: { status: "error", error: msg.slice(0, 2000) },
      });
    }
  }
  console.log("\nEros Civit A/B finished.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
