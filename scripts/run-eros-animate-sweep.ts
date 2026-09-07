/**
 * Animate (I2V) sweep from a caught gallery «Оживить» job.
 * Same grid as park/classroom: furry 0.45/0.65/0.85 @6 + 0.85 @7/8.
 * Base: Eros Max BF16, er_sde/simple.
 *
 *   npx tsx scripts/run-eros-animate-sweep.ts [animateGalleryItemId]
 */
import { PrismaClient } from "@prisma/client";
import {
  localBytesFromResultUrl,
  runI2VFromStill,
} from "../src/lib/peach-lab";
import { backupDatabase, saveGalleryBinary } from "../src/lib/local-store";
import { FURRY_NSFW_LORA_NAME } from "../src/lib/sex-loras";
import { ensureComfyReady } from "../src/lib/comfy-client";

const ANIMATE_ID = process.argv[2] || "cmtadl2nh0027v9iwoeo712pr";

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

async function waitForComfyIdle(label: string) {
  console.log(`[wait] ${label}`);
  for (let i = 0; i < 360; i++) {
    try {
      await ensureComfyReady(30, 2000);
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
      if (i % 6 === 0) console.log(`[wait] running=${running} pending=${pending}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[wait] transient: ${msg.slice(0, 160)}`);
    }
    await new Promise((r) => setTimeout(r, 10_000));
  }
  throw new Error("Comfy still busy after ~60 min");
}

async function waitForBaselineTerminal(id: string) {
  console.log(`[wait] baseline animate ${id} leave pending/busy…`);
  for (let i = 0; i < 180; i++) {
    const row = await prisma.galleryItem.findUnique({ where: { id } });
    if (!row) throw new Error(`animate item missing: ${id}`);
    let status = "unknown";
    try {
      status = String(JSON.parse(row.metaJson || "{}").status || "unknown");
    } catch {
      /* ignore */
    }
    if (status === "ready" || status === "error" || status === "failed") {
      console.log(`[wait] baseline status=${status}`);
      return row;
    }
    // If Comfy is idle but still pending, baseline worker may be stuck — proceed.
    if (i >= 3) {
      try {
        const res = await fetch("http://127.0.0.1:8188/queue");
        const q = (await res.json()) as {
          queue_running?: unknown[];
          queue_pending?: unknown[];
        };
        if (!(q.queue_running?.length || q.queue_pending?.length)) {
          if (i % 6 === 0) {
            console.log(
              `[wait] baseline still ${status}, Comfy idle — continue sweep`,
            );
          }
          if (i >= 12) return row;
        }
      } catch {
        /* ignore */
      }
    }
    if (i % 6 === 0) console.log(`[wait] baseline status=${status}`);
    await new Promise((r) => setTimeout(r, 10_000));
  }
  const row = await prisma.galleryItem.findUnique({ where: { id } });
  if (!row) throw new Error(`animate item missing: ${id}`);
  return row;
}

async function main() {
  const anim = await prisma.galleryItem.findUnique({
    where: { id: ANIMATE_ID },
  });
  if (!anim) throw new Error(`animate not found: ${ANIMATE_ID}`);
  const meta = JSON.parse(anim.metaJson || "{}") as {
    stillId?: string;
    durationSec?: number;
    withMusic?: boolean;
  };
  const stillId = meta.stillId;
  if (!stillId) throw new Error("animate meta.stillId missing");
  const still = await prisma.galleryItem.findUnique({ where: { id: stillId } });
  if (!still?.resultUrl) throw new Error(`still missing: ${stillId}`);

  const stillBytes = localBytesFromResultUrl(still.resultUrl);
  if (!stillBytes?.length) throw new Error(`still bytes missing: ${still.resultUrl}`);

  const prompt = (anim.prompt || "").trim();
  if (!prompt) throw new Error("animate prompt empty");
  const durationSec = meta.durationSec || 8;

  console.log(
    JSON.stringify(
      {
        animateId: anim.id,
        stillId: still.id,
        stillUrl: still.resultUrl,
        durationSec,
        size: `${still.width}x${still.height}`,
        promptHead: prompt.slice(0, 180),
        variants: VARIANTS,
      },
      null,
      2,
    ),
  );

  const already = await prisma.galleryItem.findMany({
    where: {
      title: { startsWith: "Оживление sweep ·" },
      resultUrl: { not: "/api/peach/gallery/placeholder" },
    },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  const doneIds = new Set<string>();
  for (const row of already) {
    try {
      const m = JSON.parse(row.metaJson || "{}") as {
        status?: string;
        variantId?: string;
      };
      if (m.status === "ready" && m.variantId) doneIds.add(m.variantId);
    } catch {
      /* */
    }
  }
  const pendingVariants = VARIANTS.filter((v) => !doneIds.has(v.id));
  console.log(
    "skip done",
    [...doneIds],
    "run",
    pendingVariants.map((v) => v.id),
  );
  if (!pendingVariants.length) {
    console.log("Nothing left for animate sweep.");
    return;
  }

  await waitForComfyIdle("park/other GPU jobs first");
  await waitForBaselineTerminal(ANIMATE_ID);
  await waitForComfyIdle("after baseline / before sweep");

  for (const v of pendingVariants) {
    await waitForComfyIdle(`before ${v.id}`);
    const strengthLabel = String(v.strength).replace("0.", "0");
    const title = `Оживление sweep · BF16+furry ${strengthLabel} er_sde/${v.steps}`;
    const loras = [{ name: FURRY_NSFW_LORA_NAME, strength: v.strength }];
    console.log("\n=== START", title, "===");

    const pending = await prisma.galleryItem.create({
      data: {
        userId: still.userId,
        characterId: still.characterId,
        kind: "video",
        title,
        prompt,
        sourceUrl: still.resultUrl,
        resultUrl: "/api/peach/gallery/placeholder",
        width: still.width,
        height: still.height,
        metaJson: JSON.stringify({
          status: "busy",
          jobAction: "animate_eros_sweep",
          stillId: still.id,
          sourceAnimateId: ANIMATE_ID,
          variantId: v.id,
          furryStrength: v.strength,
          steps: v.steps,
          sampler: SAMPLER,
          durationSec,
        }),
      },
    });

    try {
      const out = await runI2VFromStill({
        stillBytes,
        prompt,
        width: still.width || 1232,
        height: still.height || 1544,
        filenamePrefix: `peach/animate-sweep/${v.id}_${pending.id}`,
        durationSec,
        withMusic: false,
        lorasOverride: loras,
        extraTriggers: [],
        engineSuffixOverride: `eros-anim-sweep-${v.id}`,
        minimaxBase: "eros_max",
        steps: v.steps,
        samplerName: SAMPLER.samplerName,
        schedulerName: SAMPLER.schedulerName,
        extraHints: [still.prompt, still.title],
      });

      const saved = saveGalleryBinary(
        still.userId,
        "mp4",
        out.bytes,
        `animate_sweep_${pending.id}`,
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
            engine: out.engine,
            jobAction: "animate_eros_sweep",
            stillId: still.id,
            sourceAnimateId: ANIMATE_ID,
            variantId: v.id,
            furryStrength: v.strength,
            steps: v.steps,
            sampler: SAMPLER,
            durationSec,
          }),
        },
      });
      backupDatabase("eros-animate-sweep");
      console.log("READY", pending.id, out.engine, saved.publicUrl);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("FAIL", v.id, msg);
      await prisma.galleryItem.update({
        where: { id: pending.id },
        data: {
          metaJson: JSON.stringify({
            status: "error",
            error: msg.slice(0, 2000),
            jobAction: "animate_eros_sweep",
            variantId: v.id,
            sourceAnimateId: ANIMATE_ID,
          }),
        },
      });
    }
  }

  console.log("\nОживление Eros sweep finished.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
