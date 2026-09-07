/**
 * Poll in-flight TG LoRA trainings and refresh GPU status + notifications.
 */
import { prisma } from "@/lib/db";
import { readTrainMeta } from "@/lib/character-dataset";
import { refreshKreaLoraTrainStatus } from "@/lib/krea-lora-train";
import { notifyTgLoraTrainingComplete } from "@/lib/tg/lora-onboard";

let pollBusy = false;

export async function pollTgLoraTrainings(): Promise<void> {
  if (pollBusy) return;
  pollBusy = true;
  try {
    const rows = await prisma.character.findMany({
      where: { loraStatus: "lora_training", isStudioCast: false },
      select: { id: true, userId: true },
      take: 8,
    });
    if (!rows.length) return;

    const tgUserIds = new Set(
      (
        await prisma.platformAccount.findMany({
          where: {
            platform: "telegram",
            userId: { in: rows.map((r) => r.userId) },
          },
          select: { userId: true },
        })
      ).map((a) => a.userId),
    );

    for (const row of rows) {
      if (!tgUserIds.has(row.userId)) continue;
      const meta = readTrainMeta(row.id);
      if (!meta.tgNotify) continue;
      try {
        await refreshKreaLoraTrainStatus({
          userId: row.userId,
          characterId: row.id,
        });
        await notifyTgLoraTrainingComplete(row.id);
      } catch (e) {
        console.error("[tg-lora-poll]", row.id, e);
      }
    }
  } finally {
    pollBusy = false;
  }
}
