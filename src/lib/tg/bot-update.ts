import { prisma } from "@/lib/db";
import { getQuickVideoTemplateDetail } from "@/lib/quick-video-template";
import { getPhotoTemplate } from "@/lib/photo-template";
import {
  addCharacterPhotoFromBuffer,
  characterPhotoCount,
  characterReadyForVideo,
  createVideoRefCharacter,
  getActiveTgCharacter,
  listTgCharacters,
  listVideoRefCharacters,
  renameTgCharacter,
  setActiveTgCharacter,
  TG_MAX_CHARACTER_PHOTOS,
  TG_MAX_LORA_PHOTOS,
  TG_MIN_LORA_PHOTOS,
  TG_MIN_CHARACTER_PHOTOS,
  TG_MIN_VIDEO_PHOTOS,
} from "@/lib/tg/character-service";
import {
  handleCharacterCallback,
  handleCharacterTextInput,
  parseLangCb,
  sendCharactersList,
  CB,
} from "@/lib/tg/character-bot";
import {
  GEN_CB,
  OB_CB,
  VID_CB,
  parseGenPageCallback,
  parseGenPickCallback,
  photoCastPickerKeyboard,
  resolvePickIndex,
  sendTemplatePicker,
  successInlineKeyboard,
  templatePriceLabel,
} from "@/lib/tg/generation-flow";
import {
  confirmRulesAndWelcome,
  onLanguagePicked,
  onOnboardBackToName,
  onOnboardKindPicked,
  onOnboardNameEntered,
  onOnboardPhotoReceived,
  sendGenerationKindPicker,
  sendRulesStep,
  sendStartPitch,
  sendWelcomeAfterRules,
  startOnboardCharacter,
} from "@/lib/tg/onboarding-flow";
import {
  resolveTemplatePricePeaches,
  startTgPhotoGeneration,
  startTgVideoGeneration,
} from "@/lib/tg/generation-service";
import { sendHelp, sendLangSwitch } from "@/lib/tg/help-flow";
import {
  applyLookbookOption,
  saveLookbookCustom,
  sendLookbookFieldOptions,
  sendLookbookMenu,
  startLookbookCustom,
  toggleLookbookBodyPrompt,
} from "@/lib/tg/lookbook-bot";
import { mainMenuExtra, sendMainMenuHub } from "@/lib/tg/menu";
import { getTemplatePreviewUrl } from "@/lib/tg/template-preview";
import { tgAbsoluteUrl } from "@/lib/tg/media-assets";
import {
  normalizeLocale,
  t,
  tFormat,
  type TgLocale,
} from "@/lib/tg/i18n";
import {
  getTgSession,
  parsePending,
  setTgSession,
  listPendingTgOutbox,
  markTgOutboxSent,
  type TgPending,
} from "@/lib/tg/session";
import {
  tgAnswerCallbackQuery,
  tgDownloadFile,
  tgEditMessageCaption,
  tgEditMessageText,
  tgSendMessage,
  tgSendPhoto,
  tgSendVideo,
} from "@/lib/tg/telegram-api";
import {
  handleTopupAmount,
  sendInsufficientBalance,
  sendTopupPrompt,
} from "@/lib/tg/topup-flow";
import { getBalancePeaches } from "@/lib/tg/wallet";
import {
  findOrCreateTelegramUserFromBot,
  type TelegramBotUser,
} from "@/lib/tg/user";
import { isTgDevResetMessage, resetTgOnboarding } from "@/lib/tg/dev-reset";
import { maybeSendWelcomePush } from "@/lib/tg/tg-promo";
import {
  maybeSendFunnelDrips,
} from "@/lib/tg/funnel-drip";
import {
  handleFunnelNoteCommand,
  isFunnelNoteCommand,
  tryCaptureFunnelVideoNote,
} from "@/lib/tg/funnel-note-capture";
import { isTestPromoMessage, redeemTestPromo } from "@/lib/tg/test-promo";
import { goToMainMenu, routeMenuText } from "@/lib/tg/menu-routing";
import { tgMiniAppUrl, tgLoraTrainMiniAppUrl } from "@/lib/tg/miniapp-url";
import {
  isStudioCastCharacter,
  getStudioCast,
  characterUsesLoraPhoto,
  listStudioCasts,
} from "@/lib/tg/studio-cast";
import { showPhotoUploadProgress } from "@/lib/tg/photo-upload-ui";
import { ensureCopyOverlay } from "@/lib/ops/copy";

export type TgUpdateMessage = {
  message_id: number;
  chat: { id: number };
  from?: TelegramBotUser;
  text?: string;
  photo?: Array<{ file_id: string }>;
  video_note?: { file_id: string; length?: number; duration?: number };
  web_app_data?: { data: string };
};

export type TgCallbackQuery = {
  id: string;
  from: TelegramBotUser;
  message?: {
    chat: { id: number };
    message_id: number;
    photo?: unknown[];
    video?: unknown;
    animation?: unknown;
    caption?: string;
  };
  data?: string;
};

function localeFromUser(userLocale?: string | null): TgLocale {
  return normalizeLocale(userLocale);
}

async function applyLocale(userId: string, locale: TgLocale) {
  await prisma.user.update({ where: { id: userId }, data: { locale } });
}

async function handleStart(chatId: number, from: TelegramBotUser, payload?: string) {
  const user = await findOrCreateTelegramUserFromBot(from, payload);
  const locale = localeFromUser(user.locale);

  const { assertUserCanUseBot } = await import("@/lib/ops/gate");
  const gate = await assertUserCanUseBot(user.id, locale);
  if (!gate.ok) {
    await tgSendMessage(chatId, gate.message);
    return;
  }

  // Mini App → bot album upload for a specific LoRA draft character.
  if (payload?.startsWith("photos_") && user.ageConfirmed) {
    const characterId = payload.slice("photos_".length).trim();
    const ch = await prisma.character.findFirst({
      where: {
        id: characterId,
        userId: user.id,
        isStudioCast: false,
        videoRefOnly: false,
      },
    });
    if (
      ch &&
      ch.loraStatus !== "lora_ready" &&
      ch.loraStatus !== "lora_training"
    ) {
      await setTgSession(String(chatId), {
        chatState: "onboarding_awaiting_photos",
        clearPending: true,
        pending: { onboardingCharacterId: ch.id },
      });
      const n = characterPhotoCount(ch.id);
      await tgSendMessage(
        chatId,
        locale === "en"
          ? `📷 <b>${ch.name}</b>\n\nSend <b>5–20 photos</b> here as an album (or one by one).\nNow: <b>${n}</b>/${TG_MAX_LORA_PHOTOS}.\n\nWhen done, open Mini App → Characters → Train.`
          : `📷 <b>${ch.name}</b>\n\nПришли сюда <b>5–20 фото</b> альбомом (или по одному).\nСейчас: <b>${n}</b>/${TG_MAX_LORA_PHOTOS}.\n\nКогда наберёшь — Mini App → Персонажи → Обучить.`,
      );
      return;
    }
  }

  if (user.ageConfirmed) {
    await sendMainMenuHub(chatId, user.id, locale);
    return;
  }

  await setTgSession(String(chatId), { chatState: "awaiting_lang", clearPending: true });
  await sendStartPitch(chatId);
}

async function handlePhoto(
  chatId: number,
  platformUserId: string,
  userId: string,
  locale: TgLocale,
  fileId: string,
  chatState: string,
  pending: TgPending,
) {
  let character = pending.videoUploadCharacterId
    ? await prisma.character.findFirst({
        where: { id: pending.videoUploadCharacterId, userId },
      })
    : await getActiveTgCharacter(userId, platformUserId);
  if (!character && pending.onboardingCharacterId) {
    character = await prisma.character.findFirst({
      where: { id: pending.onboardingCharacterId, userId },
    });
  }
  if (!character) {
    await tgSendMessage(chatId, t("need_photos", locale));
    return;
  }

  const before = characterPhotoCount(character.id);
  const maxPhotos =
    chatState === "onboarding_awaiting_photos" ? TG_MAX_LORA_PHOTOS : TG_MAX_CHARACTER_PHOTOS;
  if (before >= maxPhotos) {
    await tgSendMessage(
      chatId,
      tFormat("photo_max", locale, { max: maxPhotos }),
    );
    return;
  }

  const buf = await tgDownloadFile(fileId);
  await addCharacterPhotoFromBuffer(
    userId,
    character.id,
    buf,
    `tg_${Date.now()}.jpg`,
    { maxPhotos },
  );

  if (
    chatState === "onboarding_awaiting_photos" ||
    (chatState === "awaiting_photos" && pending.onboardingCharacterId)
  ) {
    await onOnboardPhotoReceived(chatId, platformUserId, userId, locale, character.id);
    return;
  }

  const after = characterPhotoCount(character.id);

  const isVideoRefUpload =
    pending.templateKind === "video" &&
    pending.templateId &&
    pending.videoUploadCharacterId === character.id;

  if (isVideoRefUpload) {
    await showPhotoUploadProgress({
      chatId,
      platformUserId,
      locale,
      pending,
      mode: "video_ref",
      accepted: after,
      max: maxPhotos,
      min: TG_MIN_VIDEO_PHOTOS,
    });
    return;
  }

  if (chatState === "awaiting_photos" && !pending.onboardingCharacterId) {
    await showPhotoUploadProgress({
      chatId,
      platformUserId,
      locale,
      pending,
      mode: "character",
      accepted: after,
      max: maxPhotos,
      min: TG_MIN_CHARACTER_PHOTOS,
    });
    return;
  }

  const minNeeded =
    chatState === "onboarding_awaiting_photos"
      ? TG_MIN_LORA_PHOTOS
      : TG_MIN_CHARACTER_PHOTOS;
  const need = Math.max(0, minNeeded - after);

  await showPhotoUploadProgress({
    chatId,
    platformUserId,
    locale,
    pending,
    mode: "onboarding_lora",
    accepted: after,
    max: maxPhotos,
    min: minNeeded,
  });
}

async function loadTemplateMeta(
  userId: string,
  kind: "video" | "photo",
  templateId: string,
): Promise<{
  title: string;
  hasSpeech: boolean;
  pricePeaches: number;
  requiresLora: boolean;
  speechSlots: Array<{
    id: string;
    speaker: string;
    lang: string;
    text: string;
    label?: string;
    maxChars?: number;
  }>;
} | null> {
  if (kind === "photo") {
    const row = await getPhotoTemplate(templateId);
    if (!row) return null;
    const price = await resolveTemplatePricePeaches({
      kind: "photo",
      templateId,
      userId,
    });
    return {
      title: row.title,
      hasSpeech: row.hasSpeech,
      pricePeaches: price,
      requiresLora: false,
      speechSlots: row.hasSpeech
        ? [
            {
              id: "s1",
              speaker: "her",
              lang: "en",
              text: "",
              label: localeSafeSpeechLabel("her"),
              maxChars: 40,
            },
          ]
        : [],
    };
  }
  const { resolveVideoTemplateSpeech, speechSlotsPublicDto } = await import(
    "@/lib/tg/template-speech"
  );
  const speech = await resolveVideoTemplateSpeech(templateId);
  const slots = speechSlotsPublicDto(speech.slots, "ru");

  const loraI2v = await prisma.loraI2vTemplate.findFirst({
    where: { id: templateId, tgPublished: true },
    select: { title: true, tgDisplayTitle: true, pricePeaches: true },
  });
  if (loraI2v) {
    const price = await resolveTemplatePricePeaches({
      kind: "video",
      templateId,
      userId,
    });
    return {
      title: loraI2v.tgDisplayTitle.trim() || loraI2v.title,
      hasSpeech: speech.hasSpeech,
      pricePeaches: price,
      requiresLora: true,
      speechSlots: slots,
    };
  }
  const detail = await getQuickVideoTemplateDetail(userId, templateId);
  if (!detail) return null;
  const price = await resolveTemplatePricePeaches({
    kind: "video",
    templateId,
    userId,
  });
  return {
    title: detail.title,
    hasSpeech: speech.hasSpeech,
    pricePeaches: price,
    requiresLora: false,
    speechSlots: slots,
  };
}

function localeSafeSpeechLabel(speaker: string) {
  if (speaker === "him") return "Он";
  if (speaker === "voiceover") return "За кадром";
  return "Она";
}

function speechEditKeyboard(locale: TgLocale, multi: boolean) {
  const rows: Array<Array<{ text: string }>> = [
    [{ text: t("speech_keep", locale) }],
  ];
  if (multi) {
    rows.push([{ text: t("speech_use_defaults", locale) }]);
  }
  rows.push([{ text: t("speech_confirm", locale) }]);
  return {
    reply_markup: {
      keyboard: rows,
      resize_keyboard: true,
      one_time_keyboard: true,
    },
  };
}

async function promptSpeechSlot(
  chatId: number,
  platformUserId: string,
  locale: TgLocale,
  pending: TgPending,
) {
  const slots = pending.speechSlots || [];
  const idx = pending.speechSlotIndex ?? 0;
  const slot = slots[idx];
  if (!slot) return;
  const fills = pending.speechFills || [];
  const fill = fills.find((f) => f.id === slot.id);
  const text = (fill?.text ?? slot.text) || "—";
  const lang = fill?.lang || slot.lang || "en";
  await setTgSession(platformUserId, {
    chatState: "awaiting_speech",
    pending: { ...pending, speechSlotIndex: idx },
  });
  await tgSendMessage(
    chatId,
    tFormat("speech_slot_prompt", locale, {
      n: String(idx + 1),
      total: String(slots.length),
      label: slot.label || slot.id,
      lang,
      text,
    }),
    speechEditKeyboard(locale, slots.length > 1),
  );
}

async function finishSpeechAndContinue(
  chatId: number,
  platformUserId: string,
  userId: string,
  locale: TgLocale,
  pending: TgPending,
) {
  const fills = pending.speechFills || [];
  const next: TgPending = {
    ...pending,
    speechLine: fills[0]?.text || pending.speechLine,
    speechFills: fills,
  };
  await tgSendMessage(chatId, t("speech_done", locale));
  if (pending.templateKind === "video") {
    if (pending.requiresLora) {
      await beginLoraVideoCastFlow(chatId, platformUserId, userId, locale, next);
    } else {
      await beginVideoUploadFlow(chatId, platformUserId, userId, locale, next);
    }
  } else {
    await beginGeneration(chatId, platformUserId, userId, locale, next);
  }
}

/** Studio catalog + user's LoRA-ready models for photo confirm buttons. */
async function listPhotoConfirmModels(userId: string, locale: TgLocale) {
  const casts = await listStudioCasts(locale);
  const personal = await listTgCharacters(userId);
  const out: Array<{ id: string; name: string }> = [];
  const seen = new Set<string>();

  for (const ch of personal) {
    if (!characterUsesLoraPhoto(ch) || seen.has(ch.id)) continue;
    seen.add(ch.id);
    out.push({ id: ch.id, name: ch.name });
  }
  for (const c of casts) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    out.push({ id: c.id, name: c.name });
  }
  return out;
}

async function resolvePhotoConfirmCharacter(userId: string, characterId?: string | null) {
  if (!characterId) return null;
  const studio = await getStudioCast(characterId);
  if (studio) return studio;
  return prisma.character.findFirst({
    where: { id: characterId, userId },
  });
}

async function showTemplateConfirm(
  chatId: number,
  platformUserId: string,
  userId: string,
  locale: TgLocale,
  kind: "photo" | "video",
  templateId: string,
  title: string,
  hasSpeech: boolean,
  speechSlots: TgPending["speechSlots"] = [],
  requiresLora = false,
) {
  if (kind === "video") {
    const pricing = await templatePriceLabel({
      userId,
      kind,
      templateId,
      locale,
      character: null,
    });
    const caption = tFormat(
      requiresLora ? "gen_confirm_video_best" : "gen_confirm_video_pose",
      locale,
      {
        title,
        price: pricing.label,
      },
    );
    const markup = {
      reply_markup: {
        inline_keyboard: [
          [{ text: t("gen_confirm_btn", locale), callback_data: GEN_CB.confirm }],
          [{ text: t("gen_other_poses_btn", locale), callback_data: GEN_CB.backTemplates }],
        ],
      },
    };
    const previewUrl = await getTemplatePreviewUrl(userId, kind, templateId);
    const { tgSendPreviewMessage } = await import("@/lib/tg/media-assets");
    await tgSendPreviewMessage(chatId, previewUrl, caption, markup);
    const slots = speechSlots || [];
    await setTgSession(platformUserId, {
      chatState: "idle",
      pending: {
        templateId,
        templateKind: kind,
        title,
        hasSpeech: hasSpeech && kind === "video",
        requiresLora,
        speechSlots: slots,
        speechFills: slots.map((s) => ({
          id: s.id,
          text: s.text,
          lang: s.lang,
        })),
        speechSlotIndex: 0,
        pricePeaches: pricing.price,
        discountApplied: pricing.discountApplied,
        freePhoto: pricing.freePhoto,
        studioDaily: pricing.studioDaily,
        loraWelcome: pricing.loraWelcome,
      },
    });
    return;
  }

  const casts = await listPhotoConfirmModels(userId, locale);
  const active = await getActiveTgCharacter(userId, platformUserId);
  let selectedId =
    active && casts.some((c) => c.id === active.id)
      ? active.id
      : casts[0]?.id;

  if (selectedId && selectedId !== active?.id) {
    await setActiveTgCharacter(platformUserId, selectedId);
  }

  const character =
    (await resolvePhotoConfirmCharacter(userId, selectedId)) ||
    (await getActiveTgCharacter(userId, platformUserId));

  const pricing = await templatePriceLabel({
    userId,
    kind: "photo",
    templateId,
    locale,
    character,
  });

  const name =
    casts.find((c) => c.id === selectedId)?.name ||
    character?.name ||
    (locale === "en" ? "Model" : "Модель");

  const caption = tFormat("gen_confirm_pose", locale, {
    title,
    price: pricing.label,
    name,
  });

  const castPage = 0;
  const { keyboard } = photoCastPickerKeyboard(casts, selectedId, castPage, locale);
  const markup = { reply_markup: { inline_keyboard: keyboard } };

  const previewUrl = await getTemplatePreviewUrl(userId, "photo", templateId);
  const { tgSendPreviewMessage } = await import("@/lib/tg/media-assets");
  const sent = (await tgSendPreviewMessage(
    chatId,
    previewUrl,
    caption,
    markup,
  )) as { message_id?: number } | undefined;

  await setTgSession(platformUserId, {
    chatState: "idle",
    pending: {
      templateId,
      templateKind: "photo",
      title,
      hasSpeech: false,
      pricePeaches: pricing.price,
      discountApplied: pricing.discountApplied,
      freePhoto: pricing.freePhoto,
      studioDaily: pricing.studioDaily,
      loraWelcome: pricing.loraWelcome,
      studioCastId: selectedId,
      castPage,
      confirmMessageId: sent?.message_id,
      confirmHasMedia: Boolean(previewUrl),
    },
  });
}

async function refreshPhotoConfirmMessage(
  chatId: number,
  platformUserId: string,
  userId: string,
  locale: TgLocale,
  pending: TgPending,
  messageId: number | undefined,
  hasMedia: boolean | undefined,
) {
  const templateId = pending.templateId;
  if (!templateId) return;

  const casts = await listPhotoConfirmModels(userId, locale);
  const selectedId =
    pending.studioCastId && casts.some((c) => c.id === pending.studioCastId)
      ? pending.studioCastId
      : casts[0]?.id;

  if (selectedId) {
    await setActiveTgCharacter(platformUserId, selectedId);
  }

  const character = await resolvePhotoConfirmCharacter(userId, selectedId);

  const pricing = await templatePriceLabel({
    userId,
    kind: "photo",
    templateId,
    locale,
    character,
  });

  const name =
    casts.find((c) => c.id === selectedId)?.name ||
    character?.name ||
    (locale === "en" ? "Model" : "Модель");

  const caption = tFormat("gen_confirm_pose", locale, {
    title: pending.title || "",
    price: pricing.label,
    name,
  });

  const castPage = pending.castPage || 0;
  const { keyboard, page } = photoCastPickerKeyboard(
    casts,
    selectedId,
    castPage,
    locale,
  );
  const markup = { reply_markup: { inline_keyboard: keyboard } };
  const mid = messageId ?? pending.confirmMessageId;

  if (mid) {
    try {
      if (hasMedia ?? pending.confirmHasMedia) {
        await tgEditMessageCaption(chatId, mid, caption, markup);
      } else {
        await tgEditMessageText(chatId, mid, caption, markup);
      }
    } catch {
      /* message may be too old / identical */
    }
  }

  await setTgSession(platformUserId, {
    pending: {
      ...pending,
      studioCastId: selectedId,
      castPage: page,
      pricePeaches: pricing.price,
      discountApplied: pricing.discountApplied,
      freePhoto: pricing.freePhoto,
      studioDaily: pricing.studioDaily,
      loraWelcome: pricing.loraWelcome,
      confirmMessageId: mid,
      confirmHasMedia: hasMedia ?? pending.confirmHasMedia,
    },
  });
}

async function beginLoraVideoCastFlow(
  chatId: number,
  platformUserId: string,
  userId: string,
  locale: TgLocale,
  pending: TgPending,
) {
  const models = await listPhotoConfirmModels(userId, locale);
  await setTgSession(platformUserId, {
    chatState: "idle",
    pending: { ...pending, requiresLora: true },
  });

  if (!models.length) {
    await tgSendMessage(chatId, t("video_lora_need_train", locale), {
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: t("video_lora_train_btn", locale),
              web_app: { url: tgLoraTrainMiniAppUrl() },
            },
          ],
          [
            {
              text: t("marketplace_btn", locale),
              web_app: { url: tgMiniAppUrl("characters") },
            },
          ],
          [{ text: t("gen_other_poses_btn", locale), callback_data: GEN_CB.backTemplates }],
        ],
      },
    });
    return;
  }

  const rows: Array<
    Array<
      | { text: string; callback_data: string }
      | { text: string; web_app: { url: string } }
    >
  > = models.map((m) => [
    { text: `✨ ${m.name}`, callback_data: VID_CB.pickLora(m.id) },
  ]);
  rows.push([
    {
      text: t("video_lora_train_btn", locale),
      web_app: { url: tgLoraTrainMiniAppUrl() },
    },
  ]);
  rows.push([
    { text: t("gen_other_poses_btn", locale), callback_data: GEN_CB.backTemplates },
  ]);
  await tgSendMessage(chatId, t("video_lora_pick_title", locale), {
    reply_markup: { inline_keyboard: rows },
  });
}

async function beginVideoUploadFlow(
  chatId: number,
  platformUserId: string,
  userId: string,
  locale: TgLocale,
  pending: TgPending,
) {
  const refs = (await listVideoRefCharacters(userId)).filter((c) =>
    characterReadyForVideo(c.id),
  );

  if (refs.length) {
    const rows: Array<Array<{ text: string; callback_data: string }>> = refs.map((r) => [
      { text: `🎬 ${r.name}`, callback_data: VID_CB.pickRef(r.id) },
    ]);
    rows.push([{ text: t("video_ref_upload_new", locale), callback_data: VID_CB.uploadNew }]);
    await tgSendMessage(chatId, t("video_pick_ref_title", locale), {
      reply_markup: { inline_keyboard: rows },
    });
    await setTgSession(platformUserId, { chatState: "idle", pending });
    return;
  }

  const ch = await createVideoRefCharacter(userId, "Модель");
  await setTgSession(platformUserId, {
    chatState: "awaiting_photos",
    pending: {
      ...pending,
      videoUploadCharacterId: ch.id,
      uploadProgressMessageId: undefined,
    },
  });
  await tgSendMessage(chatId, t("video_upload_prompt", locale));
}

async function beginGeneration(
  chatId: number,
  platformUserId: string,
  userId: string,
  locale: TgLocale,
  pending: TgPending,
) {
  const kind = pending.templateKind || "video";
  const templateId = pending.templateId;
  if (!templateId) return;

  let character =
    pending.videoUploadCharacterId
      ? await prisma.character.findFirst({
          where: { id: pending.videoUploadCharacterId, userId },
        })
      : await getActiveTgCharacter(userId, platformUserId);

  if (kind === "video") {
    if (pending.requiresLora) {
      const cast =
        pending.studioCastId || pending.videoUploadCharacterId
          ? await resolvePhotoConfirmCharacter(
              userId,
              pending.studioCastId || pending.videoUploadCharacterId,
            )
          : null;
      character = cast || character;
      if (!character || !characterUsesLoraPhoto(character)) {
        await beginLoraVideoCastFlow(chatId, platformUserId, userId, locale, pending);
        return;
      }
    } else if (!character?.videoRefOnly) {
      if (!character || isStudioCastCharacter(character)) {
        await beginVideoUploadFlow(chatId, platformUserId, userId, locale, pending);
        return;
      }
      if (!characterReadyForVideo(character.id)) {
        await beginVideoUploadFlow(chatId, platformUserId, userId, locale, pending);
        return;
      }
    } else if (!characterReadyForVideo(character.id)) {
      await beginVideoUploadFlow(chatId, platformUserId, userId, locale, pending);
      return;
    }
  }

  if (kind === "photo") {
    if (!character) {
      await tgSendMessage(chatId, t("need_photos", locale));
      return;
    }
    if (isStudioCastCharacter(character)) {
      if (!pending.studioDaily && !pending.freePhoto) {
        await tgSendMessage(chatId, t("studio_free_not_ready", locale), {
          reply_markup: {
            inline_keyboard: [
              [{ text: t("marketplace_btn", locale), web_app: { url: tgMiniAppUrl() } }],
            ],
          },
        });
        return;
      }
    } else if (!characterUsesLoraPhoto(character) && !pending.loraWelcome) {
      await tgSendMessage(chatId, t("photo_need_lora", locale));
      return;
    }
  }

  const price = pending.pricePeaches ?? 0;
  if (!character) {
    await tgSendMessage(chatId, t("need_photos", locale));
    return;
  }

  if (price > 0) {
    const bal = await getBalancePeaches(userId);
    if (bal < price) {
      await sendInsufficientBalance(chatId, locale, price, bal);
      return;
    }
  }

  await tgSendMessage(chatId, t("gen_starting", locale), mainMenuExtra(locale));

  try {
    if (kind === "photo") {
      await startTgPhotoGeneration({
        userId,
        platformUserId,
        templateId,
        characterId: character.id,
        studioDaily: pending.studioDaily,
        loraWelcome: pending.loraWelcome,
      });
    } else {
      await startTgVideoGeneration({
        userId,
        platformUserId,
        templateId,
        characterId: character.id,
        speechLine: pending.speechLine,
        speechFills: pending.speechFills,
      });
    }
    await setTgSession(platformUserId, { chatState: "idle", clearPending: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("Недостаточно") || msg.includes("Insufficient")) {
      const bal = await getBalancePeaches(userId);
      await sendInsufficientBalance(chatId, locale, price, bal);
    } else {
      await tgSendMessage(
        chatId,
        tFormat("gen_error", locale, { msg }),
        mainMenuExtra(locale),
      );
    }
    await setTgSession(platformUserId, { chatState: "idle", clearPending: true });
  }
}

async function handleWebAppData(
  chatId: number,
  platformUserId: string,
  userId: string,
  locale: TgLocale,
  raw: string,
) {
  let data: {
    action?: string;
    kind?: "video" | "photo";
    templateId?: string;
    characterId?: string;
  };
  try {
    data = JSON.parse(raw) as typeof data;
  } catch {
    return;
  }
  if (data.action === "pick_cast" && data.characterId) {
    const cast = await getStudioCast(data.characterId);
    if (!cast) {
      await tgSendMessage(chatId, tFormat("gen_error", locale, { msg: "cast not found" }));
      return;
    }
    await setActiveTgCharacter(platformUserId, cast.id);
    await tgSendMessage(
      chatId,
      tFormat("studio_cast_picked", locale, { name: cast.name }),
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: t("marketplace_btn", locale), web_app: { url: tgMiniAppUrl() } }],
          ],
        },
      },
    );
    return;
  }

  if (data.action === "create_character") {
    await startOnboardCharacter(chatId, platformUserId, locale, userId);
    return;
  }

  if (data.action === "topup") {
    await sendTopupPrompt(chatId, locale);
    return;
  }

  if (data.action === "select_character" && data.characterId) {
    const ch = await prisma.character.findFirst({
      where: { id: data.characterId, userId },
    });
    if (!ch) {
      await tgSendMessage(chatId, tFormat("gen_error", locale, { msg: "character not found" }));
      return;
    }
    await setActiveTgCharacter(platformUserId, ch.id);
    await tgSendMessage(chatId, tFormat("char_selected", locale, { name: ch.name }), mainMenuExtra(locale));
    return;
  }

  if (data.action !== "use_template" || !data.templateId || !data.kind) return;

  const meta = await loadTemplateMeta(userId, data.kind, data.templateId);
  if (!meta) {
    await tgSendMessage(chatId, tFormat("gen_error", locale, { msg: "template not found" }));
    return;
  }

  await showTemplateConfirm(
    chatId,
    platformUserId,
    userId,
    locale,
    data.kind,
    data.templateId,
    meta.title,
    meta.hasSpeech,
    meta.speechSlots,
    meta.requiresLora,
  );
}

async function handleGenerationCallback(
  chatId: number,
  platformUserId: string,
  userId: string,
  locale: TgLocale,
  data: string,
  pending: TgPending,
  messageId?: number,
  hasMedia?: boolean,
): Promise<boolean> {
  if (data === GEN_CB.kindPhoto || data === GEN_CB.kindVideo) {
    const kind = data === GEN_CB.kindPhoto ? "photo" : "video";
    const { templates } = await sendTemplatePicker(chatId, userId, locale, kind, 0);
    await setTgSession(platformUserId, {
      clearPending: true,
      pending: {
        templateKind: kind,
        templatePage: 0,
        templateIds: templates.map((x) => x.id),
      },
    });
    return true;
  }

  if (data === OB_CB.kindPhoto || data === OB_CB.kindVideo) {
    const kind = data === OB_CB.kindPhoto ? "photo" : "video";
    await onOnboardKindPicked(chatId, platformUserId, userId, locale, kind);
    return true;
  }

  if (data.startsWith("g:pg:")) {
    const parsed = parseGenPageCallback(data);
    const page = parsed?.page ?? 0;
    const kind =
      parsed?.kind || pending.templateKind || "photo";
    const { templates } = await sendTemplatePicker(
      chatId,
      userId,
      locale,
      kind,
      page,
      messageId ? { editMessageId: messageId } : undefined,
    );
    await setTgSession(platformUserId, {
      clearPending: true,
      pending: {
        templateKind: kind,
        templatePage: page,
        templateIds: templates.map((x) => x.id),
      },
    });
    return true;
  }

  if (data.startsWith("g:pi:")) {
    const parsed = parseGenPickCallback(data);
    if (!parsed) return true;
    const kind = parsed.kind || pending.templateKind || "photo";
    const useCachedIds =
      pending.templateKind === kind ? pending.templateIds : undefined;
    const row = await resolvePickIndex(
      userId,
      kind,
      locale,
      parsed.idx,
      useCachedIds,
    );
    if (!row) {
      await tgSendMessage(chatId, tFormat("gen_error", locale, { msg: "template not found" }));
      return true;
    }
    const meta = await loadTemplateMeta(userId, kind, row.id);
    if (!meta) {
      await tgSendMessage(chatId, tFormat("gen_error", locale, { msg: "template not found" }));
      return true;
    }
    await showTemplateConfirm(
      chatId,
      platformUserId,
      userId,
      locale,
      kind,
      row.id,
      meta.title,
      meta.hasSpeech,
      meta.speechSlots,
      meta.requiresLora,
    );
    return true;
  }

  if (data.startsWith("g:mc:")) {
    const castId = data.slice("g:mc:".length);
    if (!pending.templateId || pending.templateKind !== "photo") return true;
    const character = await resolvePhotoConfirmCharacter(userId, castId);
    if (!character) return true;
    await setActiveTgCharacter(platformUserId, character.id);
    await refreshPhotoConfirmMessage(
      chatId,
      platformUserId,
      userId,
      locale,
      { ...pending, studioCastId: character.id },
      messageId,
      hasMedia,
    );
    return true;
  }

  if (data.startsWith("g:cp:")) {
    if (!pending.templateId || pending.templateKind !== "photo") return true;
    const page = Number(data.slice("g:cp:".length)) || 0;
    await refreshPhotoConfirmMessage(
      chatId,
      platformUserId,
      userId,
      locale,
      { ...pending, castPage: page },
      messageId,
      hasMedia,
    );
    return true;
  }

  if (data === GEN_CB.confirm && pending.templateId) {
    if (pending.hasSpeech) {
      const slots = pending.speechSlots?.length
        ? pending.speechSlots
        : [
            {
              id: "s1",
              speaker: "her",
              lang: "en",
              text: "",
              label: locale === "en" ? "Speech" : "Речь",
              maxChars: 40,
            },
          ];
      const speechPending: TgPending = {
        ...pending,
        speechSlots: slots,
        speechFills:
          pending.speechFills?.length === slots.length
            ? pending.speechFills
            : slots.map((s) => ({ id: s.id, text: s.text, lang: s.lang })),
        speechSlotIndex: 0,
      };
      await promptSpeechSlot(chatId, platformUserId, locale, speechPending);
      return true;
    }
    if (pending.templateKind === "video") {
      if (pending.requiresLora) {
        await beginLoraVideoCastFlow(
          chatId,
          platformUserId,
          userId,
          locale,
          pending,
        );
      } else {
        await beginVideoUploadFlow(chatId, platformUserId, userId, locale, pending);
      }
      return true;
    }
    if (pending.studioCastId) {
      await setActiveTgCharacter(platformUserId, pending.studioCastId);
    }
    await beginGeneration(chatId, platformUserId, userId, locale, pending);
    return true;
  }

  if (data === VID_CB.uploadNew) {
    const ch = await createVideoRefCharacter(userId, "Модель");
    await setTgSession(platformUserId, {
      chatState: "awaiting_photos",
      pending: {
        ...pending,
        videoUploadCharacterId: ch.id,
        uploadProgressMessageId: undefined,
      },
    });
    await tgSendMessage(chatId, t("video_upload_prompt", locale));
    return true;
  }

  if (data === VID_CB.photosDone) {
    const charId = pending.videoUploadCharacterId;
    if (!charId || !characterReadyForVideo(charId)) {
      await tgSendMessage(chatId, t("video_upload_prompt", locale));
      return true;
    }
    await beginGeneration(chatId, platformUserId, userId, locale, {
      ...pending,
      videoUploadCharacterId: charId,
    });
    return true;
  }

  if (data.startsWith("vid:ref:")) {
    const refId = data.slice("vid:ref:".length);
    const ref = await prisma.character.findFirst({
      where: { id: refId, userId, videoRefOnly: true },
    });
    if (!ref || !characterReadyForVideo(ref.id)) {
      await tgSendMessage(chatId, t("video_upload_prompt", locale));
      return true;
    }
    await beginGeneration(chatId, platformUserId, userId, locale, {
      ...pending,
      videoUploadCharacterId: ref.id,
    });
    return true;
  }

  if (data.startsWith("vid:lora:")) {
    const castId = data.slice("vid:lora:".length);
    const character = await resolvePhotoConfirmCharacter(userId, castId);
    if (!character || !characterUsesLoraPhoto(character)) {
      await beginLoraVideoCastFlow(chatId, platformUserId, userId, locale, pending);
      return true;
    }
    await setActiveTgCharacter(platformUserId, character.id);
    await beginGeneration(chatId, platformUserId, userId, locale, {
      ...pending,
      requiresLora: true,
      studioCastId: character.id,
      videoUploadCharacterId: character.id,
    });
    return true;
  }

  if (data === VID_CB.trainLora) {
    await startOnboardCharacter(chatId, platformUserId, locale, userId);
    return true;
  }

  if (data.startsWith("vid:save:")) {
    const charId = data.slice("vid:save:".length);
    await setTgSession(platformUserId, {
      chatState: "awaiting_video_ref_name",
      pending: { renameCharacterId: charId },
    });
    await tgSendMessage(chatId, t("video_ref_name_prompt", locale));
    return true;
  }

  if (data === VID_CB.saveSkip) {
    await setTgSession(platformUserId, { chatState: "idle", clearPending: true });
    return true;
  }

  if (data === GEN_CB.backTemplates) {
    const kind = pending.templateKind || "photo";
    const { templates } = await sendTemplatePicker(
      chatId,
      userId,
      locale,
      kind,
      pending.templatePage || 0,
    );
    await setTgSession(platformUserId, {
      clearPending: true,
      pending: {
        templateKind: kind,
        templatePage: pending.templatePage || 0,
        templateIds: templates.map((x) => x.id),
      },
    });
    return true;
  }

  if (data === GEN_CB.againPhoto) {
    const { templates } = await sendTemplatePicker(
      chatId,
      userId,
      locale,
      "photo",
      0,
    );
    await setTgSession(platformUserId, {
      clearPending: true,
      pending: {
        templateKind: "photo",
        templatePage: 0,
        templateIds: templates.map((x) => x.id),
      },
    });
    return true;
  }

  if (data === GEN_CB.againVideo) {
    const { templates } = await sendTemplatePicker(
      chatId,
      userId,
      locale,
      "video",
      0,
    );
    await setTgSession(platformUserId, {
      clearPending: true,
      pending: {
        templateKind: "video",
        templatePage: 0,
        templateIds: templates.map((x) => x.id),
      },
    });
    return true;
  }

  if (data === GEN_CB.toHub) {
    await goToMainMenu(chatId, platformUserId, userId, locale);
    return true;
  }

  return false;
}

async function handleLookbookCallback(
  chatId: number,
  platformUserId: string,
  userId: string,
  locale: TgLocale,
  data: string,
): Promise<boolean> {
  if (data.startsWith("lb:o:")) {
    await sendLookbookMenu(chatId, userId, data.slice("lb:o:".length), locale);
    return true;
  }
  if (data.startsWith("lb:bp:")) {
    const rest = data.slice("lb:bp:".length);
    const sep = rest.lastIndexOf(":");
    const charId = rest.slice(0, sep);
    const on = rest.slice(sep + 1) === "1";
    await toggleLookbookBodyPrompt(chatId, userId, charId, on, locale);
    return true;
  }
  if (data.startsWith("lb:f:")) {
    const rest = data.slice("lb:f:".length);
    const sep = rest.indexOf(":");
    const charId = rest.slice(0, sep);
    const fieldId = rest.slice(sep + 1);
    await sendLookbookFieldOptions(chatId, userId, charId, fieldId, locale);
    return true;
  }
  if (data.startsWith("lb:v:")) {
    const parts = data.slice("lb:v:".length).split(":");
    const charId = parts[0]!;
    const fieldId = parts[1]!;
    const optId = parts.slice(2).join(":");
    await applyLookbookOption(chatId, platformUserId, userId, charId, fieldId, optId, locale);
    return true;
  }
  if (data.startsWith("lb:c:")) {
    const rest = data.slice("lb:c:".length);
    const sep = rest.indexOf(":");
    await startLookbookCustom(
      chatId,
      platformUserId,
      rest.slice(0, sep),
      rest.slice(sep + 1),
      locale,
    );
    return true;
  }
  if (data.startsWith("lb:b:")) {
    const { sendCharacterDetail } = await import("@/lib/tg/character-bot");
    await sendCharacterDetail(chatId, userId, data.slice("lb:b:".length), locale);
    return true;
  }
  return false;
}

export async function handleTgCallbackQuery(cq: TgCallbackQuery) {
  await ensureCopyOverlay();
  const data = cq.data || "";
  const chatId = cq.message?.chat.id;
  if (!chatId) {
    await tgAnswerCallbackQuery(cq.id);
    return;
  }

  const platformUserId = String(chatId);
  let user = await findOrCreateTelegramUserFromBot(cq.from);
  let locale = localeFromUser(user.locale);
  const session = await getTgSession(platformUserId);
  const pending = parsePending(session?.pendingJson || "{}");

  const lang = parseLangCb(data);
  if (lang) {
    await tgAnswerCallbackQuery(cq.id);
    if (!user.ageConfirmed) {
      await onLanguagePicked(chatId, user.id, lang);
    } else {
      await applyLocale(user.id, lang);
      locale = lang;
      await tgSendMessage(chatId, t("lang_switched", locale), mainMenuExtra(locale));
    }
    return;
  }

  if (data === CB.rulesAgree || data === "rules:agree") {
    await tgAnswerCallbackQuery(cq.id);
    if (!user.ageConfirmed) {
      await confirmRulesAndWelcome(chatId, platformUserId, user.id, locale);
    }
    return;
  }

  if (data === OB_CB.uploadChar) {
    await tgAnswerCallbackQuery(cq.id);
    await startOnboardCharacter(chatId, platformUserId, locale, user.id);
    return;
  }

  if (data.startsWith("ob:pt:")) {
    await tgAnswerCallbackQuery(cq.id);
    const characterId = data.slice("ob:pt:".length);
    const { tryStartLoraTraining } = await import("@/lib/tg/lora-onboard");
    const started = await tryStartLoraTraining({
      chatId,
      platformUserId,
      userId: user.id,
      locale,
      characterId,
    });
    if (started) {
      await setTgSession(platformUserId, { chatState: "idle", clearPending: true });
    }
    return;
  }

  if (data.startsWith("ob:sc:")) {
    await tgAnswerCallbackQuery(cq.id);
    const castId = data.slice("ob:sc:".length);
    const cast = await getStudioCast(castId);
    if (cast) {
      await setActiveTgCharacter(platformUserId, cast.id);
      await tgSendMessage(
        chatId,
        tFormat("studio_cast_picked", locale, { name: cast.name }),
      );
    }
    return;
  }

  if (data === OB_CB.backName) {
    await tgAnswerCallbackQuery(cq.id);
    await onOnboardBackToName(chatId, platformUserId, locale, pending.onboardingCharacterId);
    return;
  }

  if (data === "help:lang") {
    await tgAnswerCallbackQuery(cq.id);
    await sendLangSwitch(chatId, locale);
    return;
  }

  if (data === "tu:open") {
    await tgAnswerCallbackQuery(cq.id);
    await sendTopupPrompt(chatId, locale);
    return;
  }

  if (data.startsWith("tu:") && data !== "tu:open") {
    await tgAnswerCallbackQuery(cq.id);
    const n = Number(data.slice(3));
    if (n > 0) await handleTopupAmount(chatId, platformUserId, locale, n, user.id);
    return;
  }

  if (user.ageConfirmed) {
    await maybeSendWelcomePush(chatId, user.id, locale, (body, extra) =>
      tgSendMessage(chatId, body, extra),
    );
    await maybeSendFunnelDrips(chatId, user.id);

    if (await handleGenerationCallback(
      chatId,
      platformUserId,
      user.id,
      locale,
      data,
      pending,
      cq.message?.message_id,
      Boolean(cq.message?.photo || cq.message?.video || cq.message?.animation),
    )) {
      await tgAnswerCallbackQuery(cq.id);
      return;
    }
    if (await handleLookbookCallback(chatId, platformUserId, user.id, locale, data)) {
      await tgAnswerCallbackQuery(cq.id);
      return;
    }
    if (data.startsWith("char:")) {
      await tgAnswerCallbackQuery(cq.id);
      await handleCharacterCallback(chatId, platformUserId, user.id, locale, data);
      return;
    }
  }

  await tgAnswerCallbackQuery(cq.id);
}

export async function handleTgMessage(msg: TgUpdateMessage) {
  await ensureCopyOverlay();
  const chatId = msg.chat.id;
  const platformUserId = String(chatId);
  const from = msg.from || { id: chatId };
  const text = msg.text?.trim() || "";

  let user = await findOrCreateTelegramUserFromBot(from);
  let locale = localeFromUser(user.locale);

  if (isTgDevResetMessage(text)) {
    await resetTgOnboarding(platformUserId, user.id);
    await tgSendMessage(
      chatId,
      "🔄 <b>Сброс</b>\n\nОнбординг и промо обнулены. Персонажи и баланс сохранены.\n\n<i>Onboarding reset. Characters & balance kept.</i>",
    );
    await sendStartPitch(chatId);
    return;
  }

  if (text && isFunnelNoteCommand(text)) {
    const { reply } = await handleFunnelNoteCommand(text);
    await tgSendMessage(chatId, reply);
    return;
  }

  if (msg.video_note?.file_id) {
    const captured = await tryCaptureFunnelVideoNote(msg.video_note.file_id);
    if (captured.captured) {
      await tgSendMessage(chatId, captured.reply || "✅ Saved.");
      return;
    }
  }

  if (text && isTestPromoMessage(text)) {
    const result = await redeemTestPromo(user.id, locale, text);
    if (result.ok) {
      await tgSendMessage(
        chatId,
        locale === "en"
          ? `🍑 <b>+${result.amount} peaches</b> added!\nBalance: <b>${result.balance}</b> 🍑`
          : `🍑 <b>+${result.amount} персиков</b> начислено!\nБаланс: <b>${result.balance}</b> 🍑`,
        mainMenuExtra(locale),
      );
    } else {
      await tgSendMessage(chatId, result.message, mainMenuExtra(locale));
    }
    return;
  }

  if (text.startsWith("/start")) {
    const payload = text.split(/\s+/)[1];
    await handleStart(chatId, from, payload);
    return;
  }

  const session = await getTgSession(platformUserId);
  const pending = parsePending(session?.pendingJson || "{}");
  const chatState = session?.chatState || "idle";

  if (user.ageConfirmed && text && (await routeMenuText(chatId, platformUserId, user.id, locale, text))) {
    return;
  }

  if (!user.ageConfirmed) {
    if (chatState === "awaiting_lang") {
      await sendStartPitch(chatId);
      return;
    }
    if (chatState === "awaiting_rules") {
      await sendRulesStep(chatId, locale);
      return;
    }
    await sendStartPitch(chatId);
    return;
  }

  await maybeSendWelcomePush(chatId, user.id, locale, (body, extra) =>
    tgSendMessage(chatId, body, extra),
  );
  await maybeSendFunnelDrips(chatId, user.id);

  if (chatState === "onboarding_awaiting_name" && text) {
    await onOnboardNameEntered(
      chatId,
      platformUserId,
      user.id,
      locale,
      text,
      pending.onboardingCharacterId,
    );
    return;
  }

  if (chatState === "awaiting_lookbook_custom" && text && pending.lookbookCharacterId && pending.lookbookFieldId) {
    await saveLookbookCustom(
      chatId,
      platformUserId,
      user.id,
      pending.lookbookCharacterId,
      pending.lookbookFieldId,
      text,
      locale,
    );
    return;
  }

  if (chatState === "awaiting_topup_amount" && text) {
    const n = Number(text.replace(/\s/g, ""));
    if (Number.isFinite(n)) {
      await handleTopupAmount(chatId, platformUserId, locale, Math.round(n), user.id);
    } else {
      await sendTopupPrompt(chatId, locale);
    }
    return;
  }

  if (chatState === "awaiting_video_ref_name" && text && pending.renameCharacterId) {
    await renameTgCharacter(user.id, pending.renameCharacterId, text);
    await setTgSession(platformUserId, { chatState: "idle", clearPending: true });
    await tgSendMessage(
      chatId,
      tFormat("char_selected", locale, { name: text.trim().slice(0, 40) }),
      mainMenuExtra(locale),
    );
    return;
  }

  if (
    await handleCharacterTextInput(
      chatId,
      platformUserId,
      user.id,
      locale,
      chatState,
      text,
      pending,
    )
  ) {
    return;
  }

  if (msg.web_app_data?.data) {
    await handleWebAppData(chatId, platformUserId, user.id, locale, msg.web_app_data.data);
    return;
  }

  if (msg.photo?.length) {
    const largest = msg.photo[msg.photo.length - 1]!;
    await handlePhoto(
      chatId,
      platformUserId,
      user.id,
      locale,
      largest.file_id,
      chatState,
      pending,
    );
    return;
  }

  if (chatState === "awaiting_speech" && pending.templateId) {
    const slots = pending.speechSlots || [];
    const idx = pending.speechSlotIndex ?? 0;
    const slot = slots[idx];

    if (text === t("speech_use_defaults", locale)) {
      const fills = slots.map((s) => ({
        id: s.id,
        text: s.text,
        lang: s.lang,
      }));
      await finishSpeechAndContinue(
        chatId,
        platformUserId,
        user.id,
        locale,
        { ...pending, speechFills: fills, speechLine: fills[0]?.text },
      );
      return;
    }

    if (text === t("speech_confirm", locale) || text === t("speech_keep", locale)) {
      // keep current fill for this slot and advance
      if (!slot) {
        await finishSpeechAndContinue(
          chatId,
          platformUserId,
          user.id,
          locale,
          pending,
        );
        return;
      }
      const fills = [...(pending.speechFills || [])];
      if (!fills.find((f) => f.id === slot.id)) {
        fills.push({ id: slot.id, text: slot.text, lang: slot.lang });
      }
      const nextIdx = idx + 1;
      if (nextIdx >= slots.length) {
        await finishSpeechAndContinue(
          chatId,
          platformUserId,
          user.id,
          locale,
          {
            ...pending,
            speechFills: fills,
            speechLine: fills[0]?.text || pending.speechLine,
          },
        );
        return;
      }
      await promptSpeechSlot(chatId, platformUserId, locale, {
        ...pending,
        speechFills: fills,
        speechSlotIndex: nextIdx,
      });
      return;
    }

    const langMatch = text.match(/^\/lang\s+([a-z]{2})\s*$/i);
    if (langMatch && slot) {
      const lang = langMatch[1]!.toLowerCase();
      const fills = [...(pending.speechFills || [])];
      const i = fills.findIndex((f) => f.id === slot.id);
      const nextFill = {
        id: slot.id,
        text: i >= 0 ? fills[i]!.text : slot.text,
        lang,
      };
      if (i >= 0) fills[i] = nextFill;
      else fills.push(nextFill);
      await promptSpeechSlot(chatId, platformUserId, locale, {
        ...pending,
        speechFills: fills,
        speechSlotIndex: idx,
      });
      return;
    }

    if (!slot) {
      await tgSendMessage(chatId, t("speech_prompt", locale));
      return;
    }

    const line = text.slice(0, slot.maxChars || 120);
    const fills = [...(pending.speechFills || [])];
    const i = fills.findIndex((f) => f.id === slot.id);
    const nextFill = {
      id: slot.id,
      text: line,
      lang: fills[i]?.lang || slot.lang || "en",
    };
    if (i >= 0) fills[i] = nextFill;
    else fills.push(nextFill);

    const nextIdx = idx + 1;
    if (nextIdx >= slots.length) {
      await finishSpeechAndContinue(
        chatId,
        platformUserId,
        user.id,
        locale,
        {
          ...pending,
          speechFills: fills,
          speechLine: fills[0]?.text || line,
        },
      );
      return;
    }
    await promptSpeechSlot(chatId, platformUserId, locale, {
      ...pending,
      speechFills: fills,
      speechSlotIndex: nextIdx,
    });
    return;
  }

  if (chatState === "awaiting_photos") {
    await tgSendMessage(chatId, t("upload_photos", locale));
    return;
  }

  await sendMainMenuHub(chatId, user.id, locale);
}

export async function flushTgOutbox() {
  const rows = await listPendingTgOutbox(15);
  for (const row of rows) {
    try {
      const payload = JSON.parse(row.payloadJson || "{}") as {
        url?: string;
        caption?: string;
        text?: string;
        mock?: boolean;
        successKind?: "photo" | "video";
        locale?: TgLocale;
        reply_markup?: unknown;
      };
      const chatId = Number(row.platformUserId);
      const locale = payload.locale || "ru";

      if (row.kind === "video" && payload.url) {
        await tgSendVideo(chatId, tgAbsoluteUrl(payload.url), payload.caption);
      } else if (row.kind === "photo" && payload.url) {
        await tgSendPhoto(chatId, tgAbsoluteUrl(payload.url), payload.caption);
      } else if (row.kind === "text" && payload.text) {
        const extra = payload.reply_markup
          ? { reply_markup: payload.reply_markup as Record<string, unknown> }
          : undefined;
        await tgSendMessage(chatId, payload.text, extra);
      } else if (row.kind === "error" && payload.text) {
        await tgSendMessage(chatId, payload.text);
        await markTgOutboxSent(row.id);
        continue;
      }

      if ((row.kind === "photo" || row.kind === "video") && payload.successKind) {
        const kindLabel =
          payload.successKind === "photo"
            ? t("gen_success_photo", locale)
            : t("gen_success_video", locale);
        await tgSendMessage(
          chatId,
          tFormat("gen_success", locale, { kind: kindLabel }),
          { reply_markup: successInlineKeyboard(locale) },
        );

        const saveId = (payload as { offerSaveCharacterId?: string }).offerSaveCharacterId;
        if (saveId && row.kind === "video") {
          const ch = await prisma.character.findFirst({
            where: { id: saveId, videoRefOnly: true },
          });
          if (ch && (ch.name === "Модель" || ch.name === "Model")) {
            await tgSendMessage(chatId, t("video_save_prompt", locale), {
              reply_markup: {
                inline_keyboard: [
                  [
                    {
                      text: t("video_save_yes", locale),
                      callback_data: VID_CB.saveYes(saveId),
                    },
                  ],
                  [{ text: t("video_save_skip", locale), callback_data: VID_CB.saveSkip }],
                ],
              },
            });
          }
        }
      }

      await markTgOutboxSent(row.id);
    } catch (e) {
      console.error("[tg-outbox]", row.id, e);
    }
  }
}
