import { prisma } from "@/lib/db";
import { t, type TgLocale } from "@/lib/tg/i18n";
import { tgPinChatMessage, tgSendMessage } from "@/lib/tg/telegram-api";

/** After N successful TG deliveries of photo/video work. */
export const BAN_BACKUP_GEN_MILESTONES = new Set([1, 3, 6, 9]);

const BRIDGE_URL = "https://pichbitch.live/";

function banBackupMarkup(locale: TgLocale) {
  return {
    inline_keyboard: [[{ text: t("ban_backup_btn", locale), url: BRIDGE_URL }]],
  };
}

export async function sendBanBackupNotice(
  chatId: number,
  locale: TgLocale,
  token?: string,
  opts?: { pin?: boolean },
): Promise<number | null> {
  const sent = (await tgSendMessage(
    chatId,
    t("ban_backup_notice", locale),
    {
      disable_web_page_preview: true,
      reply_markup: banBackupMarkup(locale),
    },
    token,
  )) as { message_id?: number };

  const mid = sent?.message_id ?? null;
  if (opts?.pin && mid) {
    try {
      await tgPinChatMessage(chatId, mid, {}, token);
    } catch (e) {
      console.warn(
        "[tg] pin ban-backup notice failed:",
        e instanceof Error ? e.message.slice(0, 160) : e,
      );
    }
  }
  return mid;
}

/** Once: after rules accept, before the first hub (pinned immortal link). */
export async function maybeSendBanBackupAfterOnboard(
  chatId: number,
  userId: string,
  locale: TgLocale,
  token?: string,
) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { tgBanBackupOnboardSent: true },
  });
  if (!user || user.tgBanBackupOnboardSent) return;

  // Mark first so a hub double-call can't spam / re-pin.
  await prisma.user.update({
    where: { id: userId },
    data: { tgBanBackupOnboardSent: true },
  });

  try {
    await sendBanBackupNotice(chatId, locale, token, { pin: true });
  } catch (e) {
    // Allow a later hub open to retry if send failed.
    await prisma.user
      .update({
        where: { id: userId },
        data: { tgBanBackupOnboardSent: false },
      })
      .catch(() => undefined);
    console.warn(
      "[tg] ban-backup onboard send failed:",
      e instanceof Error ? e.message.slice(0, 200) : e,
    );
  }
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
