/**
 * Eros BF16 + furry e31 strength/steps sweep.
 *   - strength 0.45 / 0.65 / 0.85 @ 6 steps
 *   - strength 0.85 @ 7 and 8 steps
 *
 *   npx tsx scripts/run-eros-classroom-sweep.ts [classroom|park]
 */
import { PrismaClient } from "@prisma/client";
import { localBytesFromResultUrl, runRef2VClip } from "../src/lib/peach-lab";
import { backupDatabase, saveGalleryBinary } from "../src/lib/local-store";
import { FURRY_NSFW_LORA_NAME } from "../src/lib/sex-loras";

const SCENES = {
  classroom: {
    sourceId: "cmt8og8bl0009v9iwr2hcna3j",
    sceneTag: "classroom",
  },
  park: {
    sourceId: "cmt8ibk5j0005v9iw21xzxnoc",
    sceneTag: "park-moscow",
  },
} as const;

const sceneKey = (process.argv[2] || "classroom").toLowerCase();
const scene =
  sceneKey === "park" || sceneKey === "park-moscow"
    ? SCENES.park
    : SCENES.classroom;
const SOURCE_RUN_ID = scene.sourceId;
const SCENE_TAG = scene.sceneTag;

const SAMPLER = {
  samplerName: "er_sde",
  schedulerName: "simple",
} as const;

const VARIANTS = [
  { id: "str045_s6", strength: 0.45, steps: 6 },
  { id: "str065_s6", strength: 0.65, steps: 6 },
  { id: "str085_s6", strength: 0.85, steps: 6 },
  { id: "str085_s7", strength: 0.85, steps: 7 },
  { id: "str085_s8", strength: 0.85, steps: 8 },
] as const;

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
        sourceId: SOURCE_RUN_ID,
        scene: SCENE_TAG,
        base: "eros_max (BF16)",
        sampler: SAMPLER,
        variants: VARIANTS,
      },
      null,
      2,
    ),
  );

  for (const v of VARIANTS) {
    const strengthLabel = String(v.strength).replace("0.", "0");
    const title = `Eros sweep · BF16+furry ${strengthLabel} er_sde/${v.steps} (${SCENE_TAG})`;
    const loras = [{ name: FURRY_NSFW_LORA_NAME, strength: v.strength }];
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
        filenamePrefix: `peach/eros-sweep/${v.id}_${run.id}`,
        lorasOverride: loras,
        extraTriggers: [],
        engineSuffixOverride: `eros-sweep-${v.id}`,
        minimaxBase: "eros_max",
        steps: v.steps,
        samplerName: SAMPLER.samplerName,
        schedulerName: SAMPLER.schedulerName,
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
            erosSweepVariant: v.id,
            minimaxBase: "eros_max",
            furryStrength: v.strength,
            steps: v.steps,
            sampler: SAMPLER,
            sourceQuickVideoRunId: SOURCE_RUN_ID,
            sceneTag: SCENE_TAG,
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
      backupDatabase("eros-classroom-sweep");
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

  console.log(`\nEros ${SCENE_TAG} sweep finished.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
