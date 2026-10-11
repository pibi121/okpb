/**
 * Announce partner payouts in the partners Telegram chat (product bot only).
 * Outbound posts — the bot ignores inbound group messages elsewhere.
 */
import { tgSendMessage } from "@/lib/tg/telegram-api";

function partnersChatId(): string {
  return (process.env.PARTNERS_TG_CHAT_ID || "").trim();
}

/** HH:mm in Europe/Moscow. */
export function formatPayoutTimeMsk(at: Date = new Date()): string {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(at);
}

export function formatPartnerPayoutAnnounce(opts: {
  amountPeaches: number;
  volumeBonusPeaches?: number;
  at?: Date;
}): string {
  const amount = Math.max(0, Math.floor(opts.amountPeaches));
  const bonus = Math.max(0, Math.floor(opts.volumeBonusPeaches || 0));
  const time = formatPayoutTimeMsk(opts.at || new Date());
  return (
    `🤑 Выплата партнёру\n\n` +
    `Время - ${time}\n` +
    `Сумма - ${amount} рублей\n` +
    `Премия за объём рефералов - ${bonus} рублей`
  );
}

async function resolveProductBotToken(): Promise<string | undefined> {
  try {
    const { resolvePrimaryLiveBot } = await import("@/lib/tg/bot-registry");
    const primary = await resolvePrimaryLiveBot();
    if (primary?.token?.trim()) return primary.token.trim();
  } catch {
    /* fall through to env */
  }
  return undefined;
}

/**
 * Post payout announce to PARTNERS_TG_CHAT_ID.
 * No-op (logs) when env is missing — ops approve still succeeds.
 */
export async function notifyPartnersChatPayout(opts: {
  amountPeaches: number;
  volumeBonusPeaches?: number;
  at?: Date;
}): Promise<{ ok: boolean; skipped?: boolean; error?: string }> {
  const chatId = partnersChatId();
  if (!chatId) {
    console.warn("[partner-payout] PARTNERS_TG_CHAT_ID unset — skip announce");
    return { ok: true, skipped: true };
  }
  const text = formatPartnerPayoutAnnounce(opts);
  try {
    const token = await resolveProductBotToken();
    await tgSendMessage(
      chatId,
      text,
      { disable_web_page_preview: true },
      token,
    );
    return { ok: true };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error("[partner-payout] send failed:", error);
    return { ok: false, error };
  }
}
