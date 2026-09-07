/**
 * Clone a QuickVideo run with Eros Max / furry A/B packs.
 *   npx tsx scripts/run-eros-ab.ts [sourceRunId]
 *
 * Variants:
 *   1. stock + furry e31 (current winner)
 *   2. eros_max alone
 *   3. eros_max + furry e31
 */
import { PrismaClient } from "@prisma/client";
import { localBytesFromResultUrl, runRef2VClip } from "../src/lib/peach-lab";
import { backupDatabase, saveGalleryBinary } from "../src/lib/local-store";
import { resolveSexLoraPack } from "../src/lib/sex-loras";
import type { MinimaxBaseId } from "../src/lib/minimax-base";
import type { MinimaxLoraSpec } from "../src/lib/anatomy-loras";

const SOURCE_RUN_ID = process.argv[2] || "";
const TITLE_PREFIX = "Eros A/B";

type Variant = {
  id: string;
  title: string;
  minimaxBase: MinimaxBaseId;
  loras: MinimaxLoraSpec[];
  triggers: string[];
  engineSuffix: string;
};

const prisma = new PrismaClient();

function parseJsonArray(raw: string): string[] {
  try {
    const j = JSON.parse(raw);
    return Array.isArray(j) ? j.filter((x: unknown) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function variants(): Variant[] {
  const furry = resolveSexLoraPack("furry_nsfw");
  return [
    {
      id: "stock+furry",
      title: `${TITLE_PREFIX} · stock + furry e31`,
      minimaxBase: "stock_ref2va",
      loras: furry.loras,
      triggers: furry.triggers,
      engineSuffix: furry.engineSuffix,
    },
    {
      id: "eros_int8",
      title: `${TITLE_PREFIX} · Eros Max int8 alone`,
      minimaxBase: "eros_max_int8",
      loras: [],
      triggers: [],
      engineSuffix: "",
    },
    {
      id: "eros_int8+furry",
      title: `${TITLE_PREFIX} · Eros Max int8 + furry e31`,
      minimaxBase: "eros_max_int8",
      loras: furry.loras,
      triggers: furry.triggers,
      engineSuffix: furry.engineSuffix,
    },
  ];
}

async function main() {
  let sourceId = SOURCE_RUN_ID;
  if (!sourceId) {
    const latest = await prisma.quickVideoRun.findFirst({
      where: { status: "ready" },
      orderBy: { createdAt: "desc" },
    });
    if (!latest) throw new Error("no ready quick video to clone");
    sourceId = latest.id;
  }

  const source = await prisma.quickVideoRun.findUnique({ where: { id: sourceId } });
  if (!source) throw new Error(`source not found: ${sourceId}`);

  const refUrls = parseJsonArray(source.refImageUrlsJson);
  const refBuffers: Buffer[] = [];
  for (const url of refUrls) {
    const b = localBytesFromResultUrl(url);
    if (!b?.length) throw new Error(`missing ref: ${url}`);
    refBuffers.push(b);
  }
  const composed = source.composedPrompt || source.prompt;
  console.log(
    "source",
    source.id,
    "title",
    source.title,
    "dur",
    source.durationSec,
    "refs",
    refBuffers.length,
  );

  for (const v of variants()) {
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
        prompt: composed,
        width: source.width,
        height: source.height,
        durationSec: source.durationSec,
        filenamePrefix: `peach/quick_${run.id}`,
        lorasOverride: v.loras,
        extraTriggers: v.triggers,
        engineSuffixOverride: v.engineSuffix,
        minimaxBase: v.minimaxBase,
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
            erosAbVariant: v.id,
            minimaxBase: v.minimaxBase,
            loras: v.loras,
            sourceQuickVideoRunId: sourceId,
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
      backupDatabase("eros-ab");
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
  console.log("\nEros A/B finished.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
