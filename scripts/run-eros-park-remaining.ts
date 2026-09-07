/**
 * Finish remaining park-moscow Eros strength/steps variants after a crash.
 *   npx tsx scripts/run-eros-park-remaining.ts
 */
import { PrismaClient } from "@prisma/client";
import { localBytesFromResultUrl, runRef2VClip } from "../src/lib/peach-lab";
import { backupDatabase, saveGalleryBinary } from "../src/lib/local-store";
import { FURRY_NSFW_LORA_NAME } from "../src/lib/sex-loras";
import { ensureComfyReady } from "../src/lib/comfy-client";

const SOURCE_RUN_ID = "cmt8ibk5j0005v9iw21xzxnoc";
const SCENE_TAG = "park-moscow";
const SAMPLER = { samplerName: "er_sde", schedulerName: "simple" } as const;
const VARIANTS = [
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

async function waitIdle() {
  for (let i = 0; i < 120; i++) {
    try {
      await ensureComfyReady(20, 2000);
      const res = await fetch("http://127.0.0.1:8188/queue");
      const q = (await res.json()) as {
        queue_running?: unknown[];
        queue_pending?: unknown[];
      };
      if (!(q.queue_running?.length || q.queue_pending?.length)) return;
    } catch (e) {
      console.warn("[wait]", e instanceof Error ? e.message : e);
    }
    await new Promise((r) => setTimeout(r, 8000));
  }
  throw new Error("Comfy not idle");
}

async function main() {
  // cancel stuck busy row from crashed park sweep
  await prisma.quickVideoRun.updateMany({
    where: {
      title: "Eros sweep · BF16+furry 085 er_sde/7 (park-moscow)",
      status: "busy",
    },
    data: { status: "error", error: "cancelled after tunnel flap; will re-run" },
  });

  const source = await prisma.quickVideoRun.findUnique({
    where: { id: SOURCE_RUN_ID },
  });
  if (!source) throw new Error("source missing");

  const refUrls = parseJsonArray(source.refImageUrlsJson);
  const refBuffers: Buffer[] = [];
  for (const url of refUrls) {
    const b = localBytesFromResultUrl(url);
    if (!b?.length) throw new Error(`missing ref ${url}`);
    refBuffers.push(b);
  }
  const composed = source.composedPrompt || source.prompt;

  for (const v of VARIANTS) {
    const existing = await prisma.quickVideoRun.findFirst({
      where: {
        title: `Eros sweep · BF16+furry 085 er_sde/${v.steps} (${SCENE_TAG})`,
        status: "ready",
      },
    });
    if (existing) {
      console.log("skip ready", existing.id, existing.title);
      continue;
    }

    await waitIdle();
    const title = `Eros sweep · BF16+furry 085 er_sde/${v.steps} (${SCENE_TAG})`;
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
        filenamePrefix: `peach/eros-sweep/${v.id}_${run.id}`,
        lorasOverride: [{ name: FURRY_NSFW_LORA_NAME, strength: v.strength }],
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
            furryStrength: v.strength,
            steps: v.steps,
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
      backupDatabase("eros-park-remaining");
      console.log("READY", run.id, saved.publicUrl);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("FAIL", v.id, msg);
      await prisma.quickVideoRun.update({
        where: { id: run.id },
        data: { status: "error", error: msg.slice(0, 2000) },
      });
    }
  }
  console.log("\nPark remaining finished.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
