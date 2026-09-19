/**
 * One-shot: send draft "Прод", delete draft "a" (stuck from double-submit).
 * Usage (prod): railway run npx tsx scripts/ops-broadcast-fix-drafts.ts
 */
import { prisma } from "../src/lib/db";
import { deleteBroadcast, runBroadcast } from "../src/lib/ops/broadcast";

async function main() {
  const drafts = await prisma.broadcast.findMany({
    where: { status: "draft", title: { in: ["Прод", "a"] } },
    orderBy: { createdAt: "asc" },
  });
  console.log(
    "drafts:",
    drafts.map((d) => ({
      id: d.id,
      title: d.title,
      at: d.createdAt.toISOString(),
    })),
  );

  const prod = drafts.find((d) => d.title === "Прод");
  const accidental = drafts.find((d) => d.title === "a");

  if (!prod) {
    console.error('Draft "Прод" not found — nothing to send');
  } else {
    console.log('Starting send for "Прод"', prod.id);
    await runBroadcast(prod.id);
    console.log('Started "Прод" (sending in background)');
  }

  if (!accidental) {
    console.log('Draft "a" not found — nothing to delete');
  } else {
    console.log('Deleting "a"', accidental.id);
    await deleteBroadcast(accidental.id);
    console.log('Deleted "a"');
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
