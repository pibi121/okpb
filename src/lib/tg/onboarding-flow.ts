import type { TgLocale } from "@/lib/tg/i18n";
import { t, tFormat } from "@/lib/tg/i18n";
import {
  scheduleWelcomePush,
  startLoraBonusWindow,
} from "@/lib/tg/tg-promo";
import { scheduleFunnelDrip } from "@/lib/tg/funnel-drip";
import { tgSendMediaMessage } from "@/lib/tg/media-assets";
import { tgRulesArticleUrl } from "@/lib/tg/rules";
import { getTgSession, parsePending, setTgSession } from "@/lib/tg/session";
import { showPhotoUploadProgress } from "@/lib/tg/photo-upload-ui";
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
import { sendMainMenuHub } from "@/lib/tg/menu";

const RULES_AUTO_MS = 5_000;

export async function sendStartPitch(chatId: number) {
  await tgSendMediaMessage(chatId, "start", t("start_pitch", "ru"));
}

/** First /start for new users: pitch → default RU → rules in ~5s. */
export async function beginOnboardingWithoutLang(
  chatId: number,
  userId: string,
) {
  const platformUserId = String(chatId);
  await prisma.user.update({
    where: { id: userId },
    data: { locale: "ru" },
  });
  const rulesAutoAt = Date.now() + RULES_AUTO_MS;
  await setTgSession(platformUserId, {
    chatState: "awaiting_rules",
    clearPending: true,
    pending: { rulesAutoAt, rulesAutoSent: false },
  });
  await sendStartPitch(chatId);

  setTimeout(() => {
    void maybeSendAutoRules(chatId, userId).catch((e) =>
      console.error("[tg-onboard] auto rules", e),
    );
  }, RULES_AUTO_MS + 50);
}

/** Send rules once when due (timer, poll, or next inbound). */
export async function maybeSendAutoRules(
  chatId: number,
  userId: string,
): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { ageConfirmed: true, locale: true },
  });
  if (!user || user.ageConfirmed) return false;

  const platformUserId = String(chatId);
  const session = await getTgSession(platformUserId);
  const pending = parsePending(session?.pendingJson || "{}");
  if (pending.rulesAutoSent) return false;
  if (session?.chatState && session.chatState !== "awaiting_rules") return false;

  const due = pending.rulesAutoAt || 0;
  if (!due || due > Date.now()) return false;

  const locale: TgLocale = user.locale === "en" ? "en" : "ru";
  await setTgSession(platformUserId, {
    chatState: "awaiting_rules",
    pending: { ...pending, rulesAutoSent: true, rulesAutoAt: due },
  });
  await sendRulesStep(chatId, locale);
  const { trackFunnelEventBg } = await import("@/lib/ops/funnel-track");
  trackFunnelEventBg({
    userId,
    platformUserId,
    eventKey: "bot.rules.shown",
    meta: { locale, auto: true },
  });
  return true;
}

export async function sendRulesStep(chatId: number, locale: TgLocale) {
  const body = tFormat("rules_step", locale, {
    rulesUrl: tgRulesArticleUrl(locale),
  });
  await tgSendMessage(chatId, body, {
    link_preview_options: { is_disabled: true },
    reply_markup: {
      inline_keyboard: [
        [{ text: t("rules_agree_btn", locale), callback_data: "rules:agree" }],
      ],
    },
  });
}

export async function onLanguagePicked(
  chatId: number,
  userId: string,
  locale: TgLocale,
) {
  await prisma.user.update({ where: { id: userId }, data: { locale } });
  const platformUserId = String(chatId);
  await setTgSession(platformUserId, {
    chatState: "awaiting_rules",
    pending: { rulesAutoSent: true },
  });
  await sendRulesStep(chatId, locale);
  const { trackFunnelEventBg } = await import("@/lib/ops/funnel-track");
  trackFunnelEventBg({
    userId,
    platformUserId,
    eventKey: "bot.rules.shown",
    meta: { locale, fromLangSwitch: true },
  });
}

export async function sendWelcomeAfterRules(
  chatId: number,
  platformUserId: string,
  locale: TgLocale,
  userId: string,
) {
  await setTgSession(platformUserId, { chatState: "idle", clearPending: true });
  await scheduleWelcomePush(userId);
  await scheduleFunnelDrip(userId);
  // Skip "Добро пожаловать…" — go straight to hub («пофантазируем») + CTAs.
  await sendMainMenuHub(chatId, userId, locale, { attachReplyKeyboard: true });
  const { trackFunnelEventBg } = await import("@/lib/ops/funnel-track");
  trackFunnelEventBg({
    userId,
    platformUserId,
    eventKey: "bot.welcome.after_rules",
    meta: { locale, hubDirect: true },
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
  const { templates } = await sendTemplatePicker(chatId, userId, locale, kind, 0);
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
  await prisma.user.update({
    where: { id: userId },
    data: { ageConfirmed: true, locale },
  });
  await sendWelcomeAfterRules(chatId, platformUserId, locale, userId);
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
