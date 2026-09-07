/**
 * End-to-end TG studio-cast LoRA photo smoke (same path as prod Mini App).
 *   npx tsx scripts/tg-gpu-photo-smoke.ts
 */
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { ensureTgBootstrap } from "../src/lib/tg/tg-bootstrap";
import { resolveKreaConceptLoras } from "../src/lib/krea-concept-loras";
import { generatePhotoBytes } from "../src/lib/peach-lab";
import { saveGalleryBinary } from "../src/lib/local-store";
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

async function main() {
  const presetPath = path.join(process.cwd(), "presets", "krea_concept_loras.json");
  if (!fs.existsSync(presetPath)) {
    throw new Error(`Missing ${presetPath}`);
  }
  console.log("[smoke] presets ok");

  if (!useComfy()) {
    throw new Error("PEACH_USE_COMFY=0 or COMFY_FORCE_MOCK=1 — enable GPU first");
  }
  if (!(await pingComfy())) {
    throw new Error(`Comfy down at ${comfyBaseUrl()} — run: npm run tunnel`);
  }
  console.log("[smoke] comfy ok");

  await ensureTgBootstrap();

  const tpl = await prisma.photoTemplate.findFirst({
    where: { title: { contains: "Член во рту" } },
    orderBy: { createdAt: "desc" },
  });
  if (!tpl) throw new Error("TG photo template not found — run bootstrap");

  const cast = await prisma.character.findFirst({
    where: { triggerWord: "olh_person", isStudioCast: true },
  });
  if (!cast) throw new Error("Lora studio cast not found");

  const owner = await prisma.user.findFirst({
    where: { email: "tg-studio@peachbitch.internal" },
  });
  if (!owner) throw new Error("studio owner missing");

  const concept = resolveKreaConceptLoras({
    scene: tpl.editPrompt,
    query: tpl.title,
  });
  console.log("[smoke] concept loras:", concept.matchedIds.join(", ") || "(none)");

  console.log("[smoke] generating…", tpl.title, "+", cast.name);

  const out = await generatePhotoBytes({
    userId: owner.id,
    tgPhotoTemplateId: tpl.id,
    characterIds: [cast.id],
    characterId: cast.id,
    composedPrompt: tpl.editPrompt,
    width: 888,
    height: 1176,
    title: `Smoke: ${tpl.title}`,
  });

  if (!out.bytes?.length || out.bytes.length < 10_000) {
    throw new Error(`Suspicious output size: ${out.bytes?.length ?? 0} bytes`);
  }

  const saved = saveGalleryBinary(owner.id, "png", out.bytes, "tg-smoke");
  console.log("[smoke] engine:", out.engine);
  console.log("[smoke] result:", saved.publicUrl);
  console.log("[smoke] bytes:", out.bytes.length);
  console.log("[smoke] OK");
}

main()
  .catch((e) => {
    console.error("[smoke] FAIL:", e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
