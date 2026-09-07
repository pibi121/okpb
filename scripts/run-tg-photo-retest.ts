/**
 * Re-run TG face+template generation (fixed NSFW/concept LoRA on dual-ref).
 *   npx tsx scripts/run-tg-photo-retest.ts
 */
import { PrismaClient } from "@prisma/client";
import { generatePhotoBytes } from "../src/lib/peach-lab";
import { saveGalleryBinary } from "../src/lib/local-store";
import { resolvePhotoPersonBuffer } from "../src/lib/photo-refs";
import {
  getTgPhotoTemplateForGeneration,
  resolveTgPhotoTemplateSceneBuffer,
} from "../src/lib/tg-photo-template-lab";

const USER_ID = "cmsa0ko34000bv9cgjm27ydny";
const TG_TEMPLATE_ID = "cmtj21ogh000hv9qwi3va5259";
const DAISY_ID = "cmt60hqyt0009v9t4eouy3ij0";

const prisma = new PrismaClient();

async function main() {
  const tpl = await getTgPhotoTemplateForGeneration(TG_TEMPLATE_ID);
  if (!tpl) throw new Error("template missing");

  const person = await resolvePhotoPersonBuffer({
    userId: USER_ID,
    characterIds: [DAISY_ID],
  });
  if (!person?.length) throw new Error("Daisy face ref missing");

  const scene = await resolveTgPhotoTemplateSceneBuffer(TG_TEMPLATE_ID);
  if (!scene?.length) throw new Error("template scene missing");

  console.log("template", tpl.title, tpl.id);
  console.log("scene bytes", scene.length, "person bytes", person.length);
  console.log("prompt", tpl.editPrompt.slice(0, 120), "...");

  const item = await prisma.galleryItem.create({
    data: {
      userId: USER_ID,
      characterId: DAISY_ID,
      kind: "photo",
      title: `TG fix: ${tpl.title}`,
      prompt: tpl.editPrompt,
      resultUrl: "/api/media/placeholder.png",
      width: 864,
      height: 1544,
      metaJson: JSON.stringify({
        tgPhotoTemplateId: TG_TEMPLATE_ID,
        characterIds: [DAISY_ID],
        status: "pending",
      }),
    },
  });

  console.log("gallery item", item.id, "— GPU…");

  const out = await generatePhotoBytes({
    userId: USER_ID,
    tgPhotoTemplateId: TG_TEMPLATE_ID,
    characterIds: [DAISY_ID],
    characterId: DAISY_ID,
    composedPrompt: tpl.editPrompt,
    dualRefPersonBuffer: person,
    dualRefSceneBuffer: scene,
    useIdentityDualRef: true,
    width: 864,
    height: 1544,
    orientationId: "9_16",
    title: `TG fix: ${tpl.title}`,
  });

  const saved = saveGalleryBinary(USER_ID, "png", out.bytes, "still");
  await prisma.galleryItem.update({
    where: { id: item.id },
    data: {
      resultUrl: saved.publicUrl,
      prompt: out.prompt,
      title: out.title || item.title,
      metaJson: JSON.stringify({
        tgPhotoTemplateId: TG_TEMPLATE_ID,
        characterIds: [DAISY_ID],
        engine: out.engine,
        conceptLoras: out.meta?.conceptLoras,
        localKey: saved.relKey,
        status: "ready",
      }),
    },
  });

  console.log("done");
  console.log("engine", out.engine);
  console.log("result", saved.publicUrl);
  console.log("gallery", item.id);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
