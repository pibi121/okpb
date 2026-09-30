/**
 * Funnel v2 secret codewords for QA.
 */
import { prisma } from "@/lib/db";
import type { TgLocale } from "@/lib/tg/i18n";
import { setTgSession } from "@/lib/tg/session";
import { tgSendMessage } from "@/lib/tg/telegram-api";
import {
  canGoLive,
  creditFunnelBalance,
  enterFunnelV2Preview,
  setFunnelV2Live,
} from "@/lib/tg/funnel-v2/mode";
import { sendFunnelV2Rules } from "@/lib/tg/funnel-v2/hub";

const TOPUP_MAP: Record<string, number> = {
  TOPUP_200: 200,
  TOPUP_600: 600,
  TOPUP_1000: 1000,
  TOPUP_2000: 2000,
  TOPUP_5000: 5000,
  TOPUP_10000: 10000,
};

async function resetFunnelFresh(
  chatId: number,
  platformUserId: string,
  userId: string,
  locale: TgLocale,
  label: string,
) {
  await enterFunnelV2Preview(userId);
  await prisma.user.update({
    where: { id: userId },
    data: {
      tgFunnelV2FaststartAt: null,
      tgFunnelV2FaststartNudgeSent: false,
      tgFunnelV2BlurOfferAt: null,
      tgFunnelV2BlurNudgeSent: false,
      tgFunnelV2BlurTrialsUsed: 0,
      tgFunnelV2RulesOk: false,
    },
  });
  await setTgSession(platformUserId, {
    chatState: "funnel_v2_awaiting_rules",
    clearPending: true,
  });
  await tgSendMessage(
    chatId,
    `🧪 <b>${label}</b>\nКак первый запуск: правила → <b>хаб</b> → фото/ген → blur.\n` +
      `Для старых аккаунтов: сброс rules/blur + preview-баланс 0. После blur — <code>TOPUP_*</code>.`,
  );
  await sendFunnelV2Rules(chatId, userId, locale);
}

export async function tryFunnelV2Codeword(opts: {
  chatId: number;
  platformUserId: string;
  userId: string;
  locale: TgLocale;
  text: string;
}): Promise<boolean> {
  const raw = opts.text.trim();
  const key = raw.toUpperCase().replace(/\s+/g, "_");

  if (key === "FUNNEL_PREVIEW") {
    await enterFunnelV2Preview(opts.userId);
    await setTgSession(opts.platformUserId, {
      chatState: "funnel_v2_awaiting_rules",
      clearPending: true,
    });
    await tgSendMessage(
      opts.chatId,
      "🧪 <b>Funnel v2 preview</b>\nОтдельная ветка: баланс 0, без старых работ. Пройди правила → меню.",
    );
    await sendFunnelV2Rules(opts.chatId, opts.userId, opts.locale);
    return true;
  }

  // FUNNEL_FRESH / FUNNEL_HUB_TEST — same: re-onboard via preview → rules → hub.
  if (key === "FUNNEL_FRESH" || key === "FUNNEL_HUB_TEST") {
    await resetFunnelFresh(
      opts.chatId,
      opts.platformUserId,
      opts.userId,
      opts.locale,
      key,
    );
    return true;
  }

  if (TOPUP_MAP[key] != null) {
    const user = await prisma.user.findUnique({ where: { id: opts.userId } });
    if (!user?.tgFunnelV2Preview) {
      await tgSendMessage(
        opts.chatId,
        "Сначала отправь <code>FUNNEL_FRESH</code> или <code>FUNNEL_HUB_TEST</code> (или <code>FUNNEL_PREVIEW</code>), чтобы войти в тестовую воронку.",
      );
      return true;
    }
    const amount = TOPUP_MAP[key];
    const bal = await creditFunnelBalance(opts.userId, amount);
    await tgSendMessage(
      opts.chatId,
      `🧪 Симуляция пополнения: <b>+${amount}🍑</b>\nБаланс preview: <b>${bal}🍑</b>`,
    );
    const { afterFunnelV2TopupCredited } = await import(
      "@/lib/tg/funnel-v2/faststart"
    );
    await afterFunnelV2TopupCredited({
      userId: opts.userId,
      peaches: amount,
    });
    return true;
  }

  if (key === "FUNNEL_GO_LIVE") {
    const user = await prisma.user.findUnique({ where: { id: opts.userId } });
    if (!user || !canGoLive(user)) {
      await tgSendMessage(opts.chatId, "Недостаточно прав для GO_LIVE.");
      return true;
    }
    await setFunnelV2Live(true);
    // Silent for end-users; only ack to the operator who typed the codeword.
    await tgSendMessage(
      opts.chatId,
      "Funnel v2 LIVE (тихо). База до выкатки зафиксирована для рассылок.",
    );
    return true;
  }

  if (key === "FUNNEL_GO_OFF") {
    const user = await prisma.user.findUnique({ where: { id: opts.userId } });
    if (!user || !canGoLive(user)) {
      await tgSendMessage(opts.chatId, "Недостаточно прав.");
      return true;
    }
    await setFunnelV2Live(false);
    await tgSendMessage(opts.chatId, "Funnel v2 live выключен. Остаётся только preview.");
    return true;
  }

  return false;
}
