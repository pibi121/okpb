/**
 * PRO entry: trained user LoRA OR a single paid topup of 1000₽+.
 */
import { prisma } from "@/lib/db";
import { isUserTrainedRealLora } from "@/lib/tg/studio-cast";

const PRO_TOPUP_MINOR = 100_000; // 1000 RUB in kopecks

export async function userHasFunnelV2ProAccess(userId: string): Promise<boolean> {
  const [chars, topup] = await Promise.all([
    prisma.character.findMany({
      where: {
        userId,
        isStudioCast: false,
        loraStatus: "lora_ready",
      },
      select: {
        isStudioCast: true,
        loraStatus: true,
        triggerWord: true,
        loraPath: true,
      },
      take: 20,
    }),
    prisma.paymentOrder.findFirst({
      where: {
        userId,
        status: "paid",
        creditedAt: { not: null },
        amountMinor: { gte: PRO_TOPUP_MINOR },
      },
      select: { id: true },
    }),
  ]);

  if (topup) return true;
  return chars.some((ch) => isUserTrainedRealLora(ch));
}
