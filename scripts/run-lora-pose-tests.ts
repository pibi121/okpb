/**
 * Create Lora+Pose test folder for Daisy and run all pending shots.
 *   npx tsx scripts/run-lora-pose-tests.ts
 */
import { PrismaClient } from "@prisma/client";
import {
  startLoraPoseTestFolder,
  resumeTestGalleryFolder,
} from "../src/lib/test-gallery";

const prisma = new PrismaClient();

async function main() {
  const daisy = await prisma.character.findFirst({
    where: { name: { contains: "Daisy" } },
  });
  if (!daisy) throw new Error("Daisy Shtorm not found");
  console.log("character", daisy.id, daisy.name, "user", daisy.userId);

  const folder = await startLoraPoseTestFolder({
    userId: daisy.userId,
    characterId: daisy.id,
    recreate: true,
  });
  if (!folder) throw new Error("folder create failed");
  console.log(
    "folder",
    folder.id,
    folder.title,
    "shots",
    folder.shots.length,
    "status",
    folder.status,
  );

  // `after()` may not run outside a Next request — drive the queue inline.
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
