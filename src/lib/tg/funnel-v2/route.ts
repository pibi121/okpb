/**
 * Funnel v2 callback + menu text router.
 */
import { prisma } from "@/lib/db";
import type { TgLocale } from "@/lib/tg/i18n";
import { tgAnswerCallbackQuery, tgSendMessage } from "@/lib/tg/telegram-api";
import { FV2, isFunnelV2Callback } from "@/lib/tg/funnel-v2/callbacks";
import {
  acceptFunnelV2Rules,
  sendFunnelV2Hub,
} from "@/lib/tg/funnel-v2/hub";
import { handleFunnelV2PhotoCallback } from "@/lib/tg/funnel-v2/photo";
import {
  handleFunnelV2TopupAmount,
  sendFunnelV2Topup,
} from "@/lib/tg/funnel-v2/topup";
import {
  sendFunnelV2Pro,
} from "@/lib/tg/funnel-v2/video-pro";
import { handleFunnelV2VideoCallback } from "@/lib/tg/funnel-v2/video";
import {
  sendFunnelV2AnimatePicker,
  sendFunnelV2EditPrompt,
  startFunnelV2Animate,
} from "@/lib/tg/funnel-v2/animate-edit";
import { userOnFunnelV2 } from "@/lib/tg/funnel-v2/mode";
import { showEarnInPlaceProxy, showHelpInPlaceProxy } from "@/lib/tg/funnel-v2/earn-help";

export { isFunnelV2Callback };

export async function handleFunnelV2Callback(opts: {
  chatId: number;
  userId: string;
  platformUserId: string;
  locale: TgLocale;
  data: string;
  callbackId: string;
  messageId?: number;
}): Promise<boolean> {
  if (!isFunnelV2Callback(opts.data)) return false;

  const user = await prisma.user.findUnique({ where: { id: opts.userId } });
  if (!user || !(await userOnFunnelV2(user))) {
    await tgAnswerCallbackQuery(opts.callbackId);
    await tgSendMessage(
      opts.chatId,
      "Эта кнопка из новой воронки. Отправь <code>FUNNEL_PREVIEW</code> или открой Главное меню после раскатки.",
    );
    return true;
  }

  await tgAnswerCallbackQuery(opts.callbackId);

  if (opts.data === FV2.rulesOk) {
    await acceptFunnelV2Rules(
      opts.chatId,
      opts.userId,
      opts.locale,
      opts.messageId,
    );
    return true;
  }
  if (opts.data === FV2.hub) {
    await sendFunnelV2Hub(opts.chatId, opts.userId, opts.locale);
    return true;
  }
  if (opts.data === FV2.photo || opts.data.startsWith("fv2:ph:")) {
    // Animate / edit first
    const editM = /^fv2:ph:ed:(.+)$/.exec(opts.data);
    if (editM) {
      await sendFunnelV2EditPrompt({
        chatId: opts.chatId,
        userId: opts.userId,
        platformUserId: opts.platformUserId,
        locale: opts.locale,
        galleryItemId: editM[1]!,
      });
      return true;
    }
    const animM = /^fv2:ph:an:([^:]+)$/.exec(opts.data);
    if (animM && !opts.data.includes(":anok:")) {
      await sendFunnelV2AnimatePicker({
        chatId: opts.chatId,
        userId: opts.userId,
        locale: opts.locale,
        galleryItemId: animM[1]!,
      });
      return true;
    }
    const anok = /^fv2:ph:anok:([^:]+):(\d+)$/.exec(opts.data);
    if (anok) {
      await startFunnelV2Animate({
        chatId: opts.chatId,
        userId: opts.userId,
        platformUserId: opts.platformUserId,
        locale: opts.locale,
        galleryItemId: anok[1]!,
        durationSec: Number(anok[2]),
      });
      return true;
    }
    return handleFunnelV2PhotoCallback(opts);
  }
  if (opts.data === FV2.video || opts.data.startsWith("fv2:vid:")) {
    return handleFunnelV2VideoCallback(opts);
  }
  if (opts.data === FV2.pro) {
    await sendFunnelV2Pro(opts.chatId, opts.locale);
    return true;
  }
  if (opts.data === FV2.topup) {
    await sendFunnelV2Topup(opts.chatId, opts.userId, opts.locale);
    return true;
  }
  const tu = /^fv2:tu:a:(\d+)$/.exec(opts.data);
  if (tu) {
    await handleFunnelV2TopupAmount(
      opts.chatId,
      opts.platformUserId,
      opts.locale,
      Number(tu[1]),
    );
    return true;
  }
  if (opts.data === FV2.earn) {
    await showEarnInPlaceProxy(opts.chatId, opts.userId, opts.locale);
    return true;
  }
  if (opts.data === FV2.earnLinks) {
    const { sendFunnelV2EarnLinks } = await import(
      "@/lib/tg/funnel-v2/earn-help"
    );
    await sendFunnelV2EarnLinks(opts.chatId, opts.userId, opts.locale);
    return true;
  }
  if (opts.data === FV2.earnNew) {
    const { beginFunnelV2EarnNewLink } = await import(
      "@/lib/tg/funnel-v2/earn-help"
    );
    await beginFunnelV2EarnNewLink(opts.chatId, opts.platformUserId);
    return true;
  }
  if (opts.data === FV2.help) {
    await showHelpInPlaceProxy(opts.chatId, opts.locale);
    return true;
  }
  return true;
}

export async function routeFunnelV2MenuText(opts: {
  chatId: number;
  platformUserId: string;
  userId: string;
  locale: TgLocale;
  text: string;
}): Promise<boolean> {
  const t = opts.text.trim();
  if (t === "🏠 Главное меню" || /^главное меню$/i.test(t.replace(/🏠/g, "").trim())) {
    await sendFunnelV2Hub(opts.chatId, opts.userId, opts.locale);
    return true;
  }
  return false;
}

/** Old hub/inline buttons while on v2 — ask to use main menu. */
export async function rejectLegacyForFunnelV2(
  chatId: number,
  callbackId?: string,
): Promise<void> {
  if (callbackId) await tgAnswerCallbackQuery(callbackId);
  await tgSendMessage(
    chatId,
    "Эта кнопка устарела. Нажми <b>🏠 Главное меню</b> или /start.",
  );
}
