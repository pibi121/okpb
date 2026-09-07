import { prisma } from "@/lib/db";

/** Secret phrase in chat to replay onboarding. Override via TG_DEV_RESET_CODE in .env */
export const TG_DEV_RESET_CODE =
  process.env.TG_DEV_RESET_CODE?.trim() || "PB_RESET_7";

export function isTgDevResetMessage(text: string): boolean {
  const t = text.trim();
  if (t === TG_DEV_RESET_CODE) return true;
  if (t === `/reset ${TG_DEV_RESET_CODE}`) return true;
  const m = t.match(/^\/reset(?:@[\w_]+)?\s+(.+)$/i);
  return m?.[1]?.trim() === TG_DEV_RESET_CODE;
}

/** Reset TG onboarding + promos so /start flow can be tested again. Keeps characters & balance. */
export async function resetTgOnboarding(
  platformUserId: string,
  userId: string,
): Promise<void> {
  await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: {
        ageConfirmed: false,
        tgFreePhotoUsed: false,
        tgFirstVideoDiscountUsed: false,
        tgStudioDailyUsedAt: null,
        tgLastMiniAppAt: null,
        tgStudioFreeReady: false,
        tgLoraBonusExpiresAt: null,
        tgLoraWelcomePhotosLeft: 0,
        tgWelcomePushSent: false,
        tgWelcomePushDueAt: null,
      },
    }),
    prisma.platformAccount.updateMany({
      where: { platform: "telegram", platformUserId, userId },
      data: {
        chatState: "awaiting_lang",
        pendingJson: "{}",
        activeCharacterId: null,
      },
    }),
  ]);
}
