/**
 * Eros BF16 + furry e31 hybrid (Civit sampling) on classroom + park prompts.
 *   npx tsx scripts/run-eros-bf16-furry.ts
 */
import { PrismaClient } from "@prisma/client";
import { localBytesFromResultUrl, runRef2VClip } from "../src/lib/peach-lab";
import { backupDatabase, saveGalleryBinary } from "../src/lib/local-store";
import { resolveSexLoraPack } from "../src/lib/sex-loras";

const CIVIT = {
  steps: 6,
  samplerName: "er_sde",
  schedulerName: "simple",
} as const;

const JOBS = [
  {
    sourceId: "cmt8og8bl0009v9iwr2hcna3j",
    sceneTag: "classroom",
  },
  {
    sourceId: "cmt8ibk5j0005v9iw21xzxnoc",
    sceneTag: "park-moscow",
  },
] as const;

const prisma = new PrismaClient();
const furry = resolveSexLoraPack("furry_nsfw");

function parseJsonArray(raw: string): string[] {
  try {
    const j = JSON.parse(raw);
    return Array.isArray(j) ? j.filter((x: unknown) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

async function main() {
  console.log(
    JSON.stringify(
      {
        civit: CIVIT,
        base: "eros_max (BF16)",
        lora: furry,
        jobs: JOBS,
      },
      null,
      2,
    ),
  );

  for (const job of JOBS) {
    const source = await prisma.quickVideoRun.findUnique({
      where: { id: job.sourceId },
    });
    if (!source) throw new Error(`source not found: ${job.sourceId}`);

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
    const title = `Eros Civit · BF16+furry e31 er_sde/6 (${job.sceneTag})`;
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
        refVideoBuffer,
        refVideoName,
        prompt: composed,
        width: source.width,
        height: source.height,
        durationSec: source.durationSec,
        filenamePrefix: `peach/eros-civit/bf16-furry_${job.sceneTag}_${run.id}`,
        lorasOverride: furry.loras,
        extraTriggers: furry.triggers,
        engineSuffixOverride: `eros-civit-bf16-furry`,
        minimaxBase: "eros_max",
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
          title,
          prompt: out.prompt,
          resultUrl: saved.publicUrl,
          width: out.size.width,
          height: out.size.height,
          metaJson: JSON.stringify({
            status: "ready",
            engine: out.engine,
            quickVideoRunId: run.id,
            erosCivitVariant: "bf16+furry",
            minimaxBase: "eros_max",
            civit: CIVIT,
            loras: furry.loras,
            sourceQuickVideoRunId: job.sourceId,
            sceneTag: job.sceneTag,
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
      backupDatabase("eros-bf16-furry");
      console.log("READY", run.id, out.engine, saved.publicUrl);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("FAIL", job.sceneTag, msg);
      await prisma.quickVideoRun.update({
        where: { id: run.id },
        data: { status: "error", error: msg.slice(0, 2000) },
      });
    }
  }

  console.log("\nEros BF16+furry finished.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
