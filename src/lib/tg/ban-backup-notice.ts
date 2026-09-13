import { prisma } from "@/lib/db";
import { t, type TgLocale } from "@/lib/tg/i18n";
import { tgSendMessage } from "@/lib/tg/telegram-api";

/** After N successful TG deliveries of photo/video work. */
export const BAN_BACKUP_GEN_MILESTONES = new Set([1, 3, 6, 9]);

export async function sendBanBackupNotice(
  chatId: number,
  locale: TgLocale,
  token?: string,
) {
  await tgSendMessage(
    chatId,
    t("ban_backup_notice", locale),
    { disable_web_page_preview: true },
    token,
  );
}

/** Once: right after the first main-menu hub (post-rules onboarding). */
export async function maybeSendBanBackupAfterOnboard(
  chatId: number,
  userId: string,
  locale: TgLocale,
) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { tgBanBackupOnboardSent: true },
  });
  if (!user || user.tgBanBackupOnboardSent) return;

  await sendBanBackupNotice(chatId, locale);
  await prisma.user.update({
    where: { id: userId },
    data: { tgBanBackupOnboardSent: true },
  });
}

/**
 * After bot delivered a finished generation (photo/video outbox).
 * Fires on the 1st, 3rd, 6th and 9th successful delivery.
 */
export async function maybeSendBanBackupAfterGeneration(
  chatId: number,
  userId: string,
  locale: TgLocale,
  token?: string,
) {
  const updated = await prisma.user.update({
    where: { id: userId },
    data: { tgDeliveredGenCount: { increment: 1 } },
    select: { tgDeliveredGenCount: true },
  });
  if (!BAN_BACKUP_GEN_MILESTONES.has(updated.tgDeliveredGenCount)) return;
  await sendBanBackupNotice(chatId, locale, token);
}
