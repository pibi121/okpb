/**
 * Reset + rerun Blowjob POV amateur test shots (LoRA-only pose text).
 *   npx tsx scripts/rerun-amateur-pov-tests.ts
 */
import { PrismaClient } from "@prisma/client";
import { resolveKreaConceptLoras } from "../src/lib/krea-concept-loras";
import { findPose } from "../src/lib/prompt-templates";
import { resumeTestGalleryFolder } from "../src/lib/test-gallery";

const POSES = ["blowjob_mouth_pov_amateur"];

const prisma = new PrismaClient();

async function main() {
  for (const id of POSES) {
    const p = findPose(id);
    const c = resolveKreaConceptLoras({ poseId: id });
    console.log(
      id,
      "textLen",
      (p?.text || "").length,
      "loras",
      c.matchedIds.join("+") || "-",
      "boosts",
      JSON.stringify(c.promptBoosts),
    );
  }

  const daisy = await prisma.character.findFirst({
    where: { name: { contains: "Daisy" } },
  });
  if (!daisy) throw new Error("Daisy not found");

  const folder = await prisma.testGalleryFolder.findUnique({
    where: { userId_slug: { userId: daisy.userId, slug: "lora-pose" } },
  });
  if (!folder) throw new Error("lora-pose folder not found");

  const shots = await prisma.testGalleryShot.findMany({
    where: { folderId: folder.id, poseId: { in: POSES } },
  });
  for (const s of shots) {
    await prisma.testGalleryShot.update({
      where: { id: s.id },
      data: {
        status: "pending",
        resultUrl: null,
        engine: null,
        prompt: null,
        error: null,
        seed: String(Math.floor(Math.random() * 1e15)),
      },
    });
  }
  console.log("reset shots", shots.length, "folder", folder.id);

  await prisma.testGalleryFolder.update({
    where: { id: folder.id },
    data: { status: "running", error: null },
  });

  console.log("running GPU queue…");
  await resumeTestGalleryFolder(folder.id, daisy.userId);
  console.log("done");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
