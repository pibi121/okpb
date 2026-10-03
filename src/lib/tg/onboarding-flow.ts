import type { TgLocale } from "@/lib/tg/i18n";
import { t, tFormat } from "@/lib/tg/i18n";
import { startLoraBonusWindow } from "@/lib/tg/tg-promo";
import { getTgSession, parsePending, setTgSession } from "@/lib/tg/session";
import { showPhotoUploadProgress } from "@/lib/tg/photo-upload-ui";
import { tgSendMediaMessage } from "@/lib/tg/media-assets";
import { tgSendMessage } from "@/lib/tg/telegram-api";
import { prisma } from "@/lib/db";
import {
  characterPhotoCount,
  createTgCharacter,
  renameTgCharacter,
  setActiveTgCharacter,
  TG_MIN_LORA_PHOTOS,
  TG_MAX_LORA_PHOTOS,
} from "@/lib/tg/character-service";
import {
  genKindInlineKeyboard,
  OB_CB,
  sendTemplatePicker,
} from "@/lib/tg/generation-flow";
import { getBalancePeaches } from "@/lib/tg/wallet";
import { loraTrainPeaches } from "@/lib/tg-pricing";
import { tryStartLoraTraining } from "@/lib/tg/lora-onboard";

/** First /start: Funnel v2 rules or hub (legacy pitch removed). */
export async function beginOnboardingWithoutLang(
  chatId: number,
  userId: string,
) {
  const gate = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      locale: true,
      ageConfirmed: true,
      tgFunnelV2Preview: true,
      tgFunnelV2RulesOk: true,
    },
  });
  if (!gate?.locale) {
    await prisma.user.update({
      where: { id: userId },
      data: { locale: "ru" },
    });
  }
  const locale: TgLocale = gate?.locale === "en" ? "en" : "ru";
  const { funnelV2RulesAccepted } = await import("@/lib/tg/funnel-v2/mode");
  if (gate && funnelV2RulesAccepted(gate)) {
    const { sendFunnelV2Hub } = await import("@/lib/tg/funnel-v2/hub");
    await sendFunnelV2Hub(chatId, userId, locale);
  } else {
    const { sendFunnelV2Rules } = await import("@/lib/tg/funnel-v2/hub");
    await sendFunnelV2Rules(chatId, userId, locale);
  }
}

export async function onLanguagePicked(
  chatId: number,
  userId: string,
  locale: TgLocale,
) {
  await prisma.user.update({ where: { id: userId }, data: { locale } });
  const { sendFunnelV2Rules } = await import("@/lib/tg/funnel-v2/hub");
  await sendFunnelV2Rules(chatId, userId, locale);
  const { trackFunnelEventBg } = await import("@/lib/ops/funnel-track");
  trackFunnelEventBg({
    userId,
    platformUserId: String(chatId),
    eventKey: "bot.rules.shown",
    meta: { locale, fromLangSwitch: true },
  });
}

export async function startOnboardCharacter(
  chatId: number,
  platformUserId: string,
  locale: TgLocale,
  userId: string,
) {
  await startLoraBonusWindow(userId);
  await setTgSession(platformUserId, { chatState: "onboarding_awaiting_name" });
  await tgSendMessage(chatId, t("onboard_name_prompt", locale));
}

export async function onOnboardNameEntered(
  chatId: number,
  platformUserId: string,
  userId: string,
  locale: TgLocale,
  name: string,
  existingCharacterId?: string,
) {
  let characterId = existingCharacterId;
  if (characterId) {
    await renameOnboardingCharacter(userId, characterId, name);
  } else {
    const ch = await createTgCharacter(userId, name);
    characterId = ch.id;
  }
  await setActiveTgCharacter(platformUserId, characterId);
  await setTgSession(platformUserId, {
    chatState: "onboarding_awaiting_photos",
    pending: { onboardingCharacterId: characterId },
  });

  await tgSendMediaMessage(chatId, "photo_upload", t("onboard_photo_prompt", locale));

  await import("@/lib/ops/prices").then(({ ensurePriceOverlay }) =>
    ensurePriceOverlay(),
  );
  const price = loraTrainPeaches();
  const balance = await getBalancePeaches(userId);
  await tgSendMessage(chatId, tFormat("onboard_lora_price", locale, { price, balance }), {
    reply_markup:
      balance >= price
        ? undefined
        : {
            inline_keyboard: [
              [{ text: t("topup_btn", locale), callback_data: "tu:open" }],
            ],
          },
  });

  if (balance >= price) {
    await tgSendMessage(chatId, t("onboard_lora_upload", locale), {
      reply_markup: {
        inline_keyboard: [
          [{ text: t("onboard_back_name_btn", locale), callback_data: OB_CB.backName }],
        ],
      },
    });
  }
}

export async function onOnboardBackToName(
  chatId: number,
  platformUserId: string,
  locale: TgLocale,
  characterId?: string,
) {
  await setTgSession(platformUserId, {
    chatState: "onboarding_awaiting_name",
    pending: characterId ? { onboardingCharacterId: characterId } : {},
  });
  await tgSendMessage(chatId, t("onboard_name_prompt", locale));
}

export async function onOnboardPhotoReceived(
  chatId: number,
  platformUserId: string,
  userId: string,
  locale: TgLocale,
  characterId: string,
) {
  const n = characterPhotoCount(characterId);
  const need = Math.max(0, TG_MIN_LORA_PHOTOS - n);

  const session = await getTgSession(platformUserId);
  const pending = parsePending(session?.pendingJson || "{}");

  await showPhotoUploadProgress({
    chatId,
    platformUserId,
    locale,
    pending,
    mode: "onboarding_lora",
    accepted: n,
    max: TG_MAX_LORA_PHOTOS,
    min: TG_MIN_LORA_PHOTOS,
  });

  if (need > 0) {
    return;
  }

  const started = await tryStartLoraTraining({
    chatId,
    platformUserId,
    userId,
    locale,
    characterId,
  });

  if (started) {
    await setTgSession(platformUserId, { chatState: "idle", clearPending: true });
  }
}

export async function onOnboardKindPicked(
  chatId: number,
  platformUserId: string,
  userId: string,
  locale: TgLocale,
  kind: "photo" | "video",
) {
  if (kind === "video") {
    const { sendVideoModePicker } = await import("@/lib/tg/generation-flow");
    await sendVideoModePicker(chatId, locale);
    await setTgSession(platformUserId, {
      chatState: "idle",
      clearPending: true,
      pending: { templateKind: "video" },
    });
    return;
  }
  const { templates } = await sendTemplatePicker(chatId, userId, locale, kind, 0, {
    reshuffle: true,
  });
  await setTgSession(platformUserId, {
    chatState: "idle",
    clearPending: true,
    pending: {
      templateKind: kind,
      templatePage: 0,
      templateIds: templates.map((x) => x.id),
    },
  });
}

export async function confirmRulesAndWelcome(
  chatId: number,
  platformUserId: string,
  userId: string,
  locale: TgLocale,
) {
  void platformUserId;
  const { acceptFunnelV2Rules } = await import("@/lib/tg/funnel-v2/hub");
  await acceptFunnelV2Rules(chatId, userId, locale);
}

/** Rules agree nudges: 10m / 3h / 24h after first rules message. */
/** Stop all rules nudges when user blocked the bot / chat gone. */
async function silenceRulesNudges(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: {
      tgRulesNudge10mSent: true,
      tgRulesNudge3hSent: true,
      tgRulesNudge24hSent: true,
    },
  });
}

function isDeadTelegramChat(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /bot was blocked|chat not found|user is deactivated|Forbidden: bot|PEER_ID_INVALID/i.test(
    msg,
  );
}

/** Rules agree nudges 10m / 3h / 24h — always current Funnel rules screen. */
export async function maybeSendRulesNudges(
  chatId: number,
  userId: string,
): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      ageConfirmed: true,
      locale: true,
      createdAt: true,
      tgRulesShownAt: true,
      tgRulesNudge10mSent: true,
      tgRulesNudge3hSent: true,
      tgRulesNudge24hSent: true,
      tgFunnelV2Preview: true,
      tgFunnelV2RulesOk: true,
    },
  });
  if (!user) return;

  const { funnelV2RulesAccepted } = await import("@/lib/tg/funnel-v2/mode");
  if (funnelV2RulesAccepted(user)) return;

  const locale: TgLocale = user.locale === "en" ? "en" : "ru";
  const anchor = user.tgRulesShownAt?.getTime() || user.createdAt.getTime();
  const ageMs = Date.now() - anchor;
  const MS_10M = 10 * 60_000;
  const MS_3H = 3 * 60 * 60_000;
  const MS_24H = 24 * 60 * 60_000;

  const sendV2 = async (
    flag: "tgRulesNudge10mSent" | "tgRulesNudge3hSent" | "tgRulesNudge24hSent",
    eventKey: string,
  ) => {
    try {
      const { resolveUserTelegramDelivery } = await import(
        "@/lib/tg/notify-user"
      );
      const dest = await resolveUserTelegramDelivery(userId);
      if (!dest?.token) {
        await silenceRulesNudges(userId);
        return;
      }
      const { sendFunnelV2Rules } = await import("@/lib/tg/funnel-v2/hub");
      await sendFunnelV2Rules(chatId, userId, locale, { token: dest.token });
      await prisma.user.update({
        where: { id: userId },
        data: { [flag]: true },
      });
      const { trackFunnelEventBg } = await import("@/lib/ops/funnel-track");
      trackFunnelEventBg({
        userId,
        platformUserId: String(chatId),
        eventKey,
        surface: "system",
      });
    } catch (e) {
      if (isDeadTelegramChat(e)) {
        await silenceRulesNudges(userId);
        return;
      }
      throw e;
    }
  };

  if (!user.tgRulesNudge10mSent && ageMs >= MS_10M) {
    await sendV2("tgRulesNudge10mSent", "bot.rules.nudge_10m");
    return;
  }
  if (!user.tgRulesNudge3hSent && ageMs >= MS_3H) {
    await sendV2("tgRulesNudge3hSent", "bot.rules.nudge_3h");
    return;
  }
  if (!user.tgRulesNudge24hSent && ageMs >= MS_24H) {
    await sendV2("tgRulesNudge24hSent", "bot.rules.nudge_24h");
  }
}

export async function sendGenerationKindPicker(chatId: number, locale: TgLocale) {
  await tgSendMessage(chatId, t("gen_pick_kind", locale), {
    reply_markup: genKindInlineKeyboard(locale),
  });
}

export async function renameOnboardingCharacter(
  userId: string,
  characterId: string,
  name: string,
) {
  await renameTgCharacter(userId, characterId, name);
}

export { TG_MAX_LORA_PHOTOS };
