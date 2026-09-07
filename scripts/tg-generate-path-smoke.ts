/**
 * Full TG photo path smoke — enqueuePhotoJob outside Next.js request (bot/Railway).
 *   npx tsx scripts/tg-generate-path-smoke.ts
 */
import { PrismaClient } from "@prisma/client";
import { ensureTgBootstrap } from "../src/lib/tg/tg-bootstrap";
import { enqueuePhotoJob } from "../src/lib/gallery-jobs";
import { useComfy, comfyBaseUrl } from "../src/lib/metalnode-config";

const prisma = new PrismaClient();

async function pingComfy() {
  try {
    const res = await fetch(`${comfyBaseUrl()}/system_stats`, {
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function waitForItem(id: string, userId: string, timeoutMs = 120000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const item = await prisma.galleryItem.findFirst({ where: { id, userId } });
    if (!item) throw new Error("gallery item vanished");
    let meta: { status?: string; error?: string; engine?: string } = {};
    try {
      meta = JSON.parse(item.metaJson || "{}") as typeof meta;
    } catch {
      /* ignore */
    }
    if (meta.status === "ready") return item;
    if (meta.status === "error") {
      throw new Error(meta.error || "generation failed");
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error("timeout waiting for generation");
}

async function main() {
  if (!useComfy() || !(await pingComfy())) {
    throw new Error("GPU/Comfy not available — run: npm run tunnel");
  }

  await ensureTgBootstrap();

  const tpl = await prisma.photoTemplate.findFirst({
    where: { title: { contains: "Член во рту" } },
  });
  const cast = await prisma.character.findFirst({
    where: { triggerWord: "olh_person", isStudioCast: true },
  });
  const owner = await prisma.user.findFirst({
    where: { email: "tg-studio@peachbitch.internal" },
  });
  if (!tpl || !cast || !owner) throw new Error("bootstrap data missing");

  console.log("[path-smoke] enqueuePhotoJob (no Next request)…");
  const item = await enqueuePhotoJob(owner.id, {
    userId: owner.id,
    tgPhotoTemplateId: tpl.id,
    characterIds: [cast.id],
    characterId: cast.id,
    composedPrompt: tpl.editPrompt,
    studioCastLora: true,
    title: tpl.title,
    width: 888,
    height: 1176,
  });

  console.log("[path-smoke] pending item", item.id);
  const done = await waitForItem(item.id, owner.id);
  let meta: { engine?: string } = {};
  try {
    meta = JSON.parse(done.metaJson || "{}") as typeof meta;
  } catch {
    /* ignore */
  }
  console.log("[path-smoke] ready:", done.resultUrl);
  console.log("[path-smoke] engine:", meta.engine);
  console.log("[path-smoke] OK");
}

main()
  .catch((e) => {
    console.error("[path-smoke] FAIL:", e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
