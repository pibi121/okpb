/**
 * Clone a quick-video run with sex LoRA A/B packs.
 *   npx tsx scripts/run-sex-lora-ab.ts [sourceRunId] [titlePrefix]
 *
 * Defaults: last hardcoded Moscow baseline + "LoRA A/B".
 */
import { PrismaClient } from "@prisma/client";
import { localBytesFromResultUrl, runRef2VClip } from "../src/lib/peach-lab";
import { backupDatabase, saveGalleryBinary } from "../src/lib/local-store";
import {
  resolveSexLoraPack,
  type SexLoraMode,
} from "../src/lib/sex-loras";

const SOURCE_RUN_ID = process.argv[2] || "cmt8ibk5j0005v9iw21xzxnoc";
const TITLE_PREFIX = process.argv[3] || "LoRA A/B";

const MODES: SexLoraMode[] = ["hmnsfw_aio", "furry_nsfw", "hmnsfw_aio+furry"];

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
  if (!source) throw new Error(`source run not found: ${SOURCE_RUN_ID}`);

  const baselineTitle = `${TITLE_PREFIX} · baseline (no sex LoRA)`;
  // Label the baseline for the cabinet comparison.
  if (source.title === "Quick video" || !source.title.startsWith(TITLE_PREFIX)) {
    await prisma.quickVideoRun.update({
      where: { id: source.id },
      data: { title: baselineTitle },
    });
    if (source.galleryItemId) {
      await prisma.galleryItem.update({
        where: { id: source.galleryItemId },
        data: { title: baselineTitle },
      });
    }
    console.log("renamed baseline ->", baselineTitle);
  }

  const refUrls = parseJsonArray(source.refImageUrlsJson);
  const refBuffers: Buffer[] = [];
  for (const url of refUrls) {
    const b = localBytesFromResultUrl(url);
    if (!b?.length) throw new Error(`missing ref bytes: ${url}`);
    refBuffers.push(b);
  }

  const composed = source.composedPrompt || source.prompt;
  console.log(
    "source",
    source.id,
    "refs",
    refBuffers.length,
    "dur",
    source.durationSec,
    "size",
    `${source.width}x${source.height}`,
  );

  for (const mode of MODES) {
    const pack = resolveSexLoraPack(mode);
    const title = `${TITLE_PREFIX} · ${pack.label}`;
    console.log("\n=== START", title, "===");

    const run = await prisma.quickVideoRun.create({
      data: {
        userId: source.userId,
        title,
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
        lorasOverride: pack.loras,
        extraTriggers: pack.triggers,
        engineSuffixOverride: pack.engineSuffix,
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
          title,
          prompt: out.prompt,
          resultUrl: saved.publicUrl,
          width: out.size.width,
          height: out.size.height,
          metaJson: JSON.stringify({
            status: "ready",
            engine: out.engine,
            quickVideoRunId: run.id,
            sexLoraMode: mode,
            loras: pack.loras,
            triggers: pack.triggers,
            sourceQuickVideoRunId: SOURCE_RUN_ID,
            refImageUrls: refUrls,
            orientation: source.orientation,
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
      backupDatabase("sex-lora-ab");
      console.log("READY", run.id, out.engine, saved.publicUrl);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("FAIL", mode, msg);
      await prisma.quickVideoRun.update({
        where: { id: run.id },
        data: { status: "error", error: msg.slice(0, 2000) },
      });
    }
  }

  console.log("\nAll A/B jobs finished.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
