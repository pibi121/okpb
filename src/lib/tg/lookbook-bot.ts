import { prisma } from "@/lib/db";
import {
  CUSTOM_PREFIX,
  FEMALE_LOOKBOOK_FIELDS,
  fieldsForGender,
  isLookbookFieldInPrompt,
  parseLookbook,
  setLookbookFieldInPrompt,
  toCustomValue,
  type LookbookField,
  type LookbookValues,
} from "@/lib/lookbook";
import type { TgLocale } from "@/lib/tg/i18n";
import { t, tFormat } from "@/lib/tg/i18n";
import { setTgSession } from "@/lib/tg/session";
import { tgSendMessage } from "@/lib/tg/telegram-api";

/** Body-related fields for TG MVP (figure preset + intimate). */
const TG_LOOKBOOK_FIELD_IDS = ["body", "genital_hair"] as const;

export const LB_CB = {
  open: (charId: string) => `lb:o:${charId}`,
  field: (charId: string, fieldId: string) => `lb:f:${charId}:${fieldId}`,
  opt: (charId: string, fieldId: string, optId: string) =>
    `lb:v:${charId}:${fieldId}:${optId}`,
  custom: (charId: string, fieldId: string) => `lb:c:${charId}:${fieldId}`,
  /** Toggle whether body field is injected into prompts */
  bodyPrompt: (charId: string, on: 0 | 1) => `lb:bp:${charId}:${on}`,
  backChar: (charId: string) => `lb:b:${charId}`,
} as const;

function tgLookbookFields(): LookbookField[] {
  const all = fieldsForGender("female");
  return TG_LOOKBOOK_FIELD_IDS.map(
    (id) => all.find((f) => f.id === id)!,
  ).filter(Boolean);
}

function fieldLabel(field: LookbookField, locale: TgLocale): string {
  if (locale === "en") {
    const map: Record<string, string> = {
      body: "Figure (height + build)",
      genital_hair: "Pubic area",
    };
    return map[field.id] || field.label;
  }
  return field.label;
}

function optionLabel(
  field: LookbookField,
  value: string | undefined,
  locale: TgLocale,
): string {
  if (!value) return locale === "en" ? "Default" : "По умолчанию";
  if (value.startsWith(CUSTOM_PREFIX)) {
    return value.slice(CUSTOM_PREFIX.length) || (locale === "en" ? "Custom" : "Своё");
  }
  const opt = field.options.find((o) => o.id === value);
  if (!opt) return value;
  // Short UI label only — en prompts are long clauses for Comfy, not buttons.
  return opt.label;
}

async function loadLookbook(characterId: string, userId: string) {
  const ch = await prisma.character.findFirst({
    where: { id: characterId, userId },
  });
  if (!ch) return null;
  return {
    ch,
    values: parseLookbook(ch.lookbookJson, "female"),
  };
}

async function saveLookbook(characterId: string, values: LookbookValues) {
  await prisma.character.update({
    where: { id: characterId },
    data: { lookbookJson: JSON.stringify(values) },
  });
}

export async function sendLookbookMenu(
  chatId: number,
  userId: string,
  characterId: string,
  locale: TgLocale,
) {
  const data = await loadLookbook(characterId, userId);
  if (!data) {
    await tgSendMessage(chatId, t("char_not_found", locale));
    return;
  }

  const fields = tgLookbookFields();
  const bodyOn = isLookbookFieldInPrompt(data.values, "body");
  const rows: Array<Array<{ text: string; callback_data: string }>> = [
    [
      {
        text: bodyOn
          ? locale === "en"
            ? "✅ Body in prompt: ON"
            : "✅ Тело в промпте: ВКЛ"
          : locale === "en"
            ? "⬜ Body in prompt: OFF"
            : "⬜ Тело в промпте: ВЫКЛ",
        callback_data: LB_CB.bodyPrompt(characterId, bodyOn ? 0 : 1),
      },
    ],
  ];
  for (const f of fields) {
    const disabled = f.id === "body" && !bodyOn;
    rows.push([
      {
        text: `${disabled ? "🔒 " : ""}${fieldLabel(f, locale)}: ${optionLabel(f, data.values[f.id], locale)}`.slice(
          0,
          60,
        ),
        callback_data: LB_CB.field(characterId, f.id),
      },
    ]);
  }
  rows.push([{ text: t("lb_back_btn", locale), callback_data: LB_CB.backChar(characterId) }]);

  await tgSendMessage(
    chatId,
    tFormat("lb_pick_field", locale, { name: data.ch.name }),
    { reply_markup: { inline_keyboard: rows } },
  );
}

export async function sendLookbookFieldOptions(
  chatId: number,
  userId: string,
  characterId: string,
  fieldId: string,
  locale: TgLocale,
) {
  const data = await loadLookbook(characterId, userId);
  const field = tgLookbookFields().find((f) => f.id === fieldId);
  if (!data || !field) return;

  if (fieldId === "body" && !isLookbookFieldInPrompt(data.values, "body")) {
    await tgSendMessage(
      chatId,
      locale === "en"
        ? "Body prompt is OFF. Turn it on first to change the figure preset."
        : "Тело в промпте выключено. Сначала включи — потом можно менять фигуру.",
    );
    await sendLookbookMenu(chatId, userId, characterId, locale);
    return;
  }

  const rows: Array<Array<{ text: string; callback_data: string }>> = [];
  for (const opt of field.options) {
    rows.push([
      {
        text: opt.label.slice(0, 40),
        callback_data: LB_CB.opt(characterId, fieldId, opt.id),
      },
    ]);
  }
  if (field.allowCustom) {
    rows.push([
      {
        text: locale === "en" ? "✏️ Custom" : "✏️ Своё",
        callback_data: LB_CB.custom(characterId, fieldId),
      },
    ]);
  }
  rows.push([{ text: t("lb_back_btn", locale), callback_data: LB_CB.open(characterId) }]);

  await tgSendMessage(
    chatId,
    tFormat("lb_title", locale, {
      name: data.ch.name,
      field: fieldLabel(field, locale),
      value: optionLabel(field, data.values[fieldId], locale),
    }),
    { reply_markup: { inline_keyboard: rows } },
  );
}

export async function toggleLookbookBodyPrompt(
  chatId: number,
  userId: string,
  characterId: string,
  enabled: boolean,
  locale: TgLocale,
) {
  const data = await loadLookbook(characterId, userId);
  if (!data) {
    await tgSendMessage(chatId, t("char_not_found", locale));
    return;
  }
  const next = setLookbookFieldInPrompt(data.values, "body", enabled);
  await saveLookbook(characterId, next);
  await tgSendMessage(
    chatId,
    enabled
      ? locale === "en"
        ? "Body text ON — figure preset goes into photo & video prompts."
        : "Тело ВКЛ — описание фигуры уходит в промпт фото и видео."
      : locale === "en"
        ? "Body text OFF — proportions follow reference photos only."
        : "Тело ВЫКЛ — пропорции только с референс-фото.",
  );
  await sendLookbookMenu(chatId, userId, characterId, locale);
}

export async function applyLookbookOption(
  chatId: number,
  platformUserId: string,
  userId: string,
  characterId: string,
  fieldId: string,
  optId: string,
  locale: TgLocale,
) {
  const data = await loadLookbook(characterId, userId);
  const field = tgLookbookFields().find((f) => f.id === fieldId);
  if (!data || !field) return;

  const next = { ...data.values, [fieldId]: optId };
  await saveLookbook(characterId, next);
  await tgSendMessage(
    chatId,
    tFormat("lb_saved", locale, {
      field: fieldLabel(field, locale),
      value: optionLabel(field, optId, locale),
    }),
  );
  await sendLookbookMenu(chatId, userId, characterId, locale);
}

export async function startLookbookCustom(
  chatId: number,
  platformUserId: string,
  characterId: string,
  fieldId: string,
  locale: TgLocale,
) {
  const field = tgLookbookFields().find((f) => f.id === fieldId);
  if (!field) return;
  await setTgSession(platformUserId, {
    chatState: "awaiting_lookbook_custom",
    pending: { lookbookCharacterId: characterId, lookbookFieldId: fieldId },
  });
  await tgSendMessage(
    chatId,
    tFormat("lb_custom_prompt", locale, { field: fieldLabel(field, locale) }),
  );
}

export async function saveLookbookCustom(
  chatId: number,
  platformUserId: string,
  userId: string,
  characterId: string,
  fieldId: string,
  text: string,
  locale: TgLocale,
) {
  const data = await loadLookbook(characterId, userId);
  const field = tgLookbookFields().find((f) => f.id === fieldId);
  if (!data || !field) return;

  const next = { ...data.values, [fieldId]: toCustomValue(text) };
  await saveLookbook(characterId, next);
  await setTgSession(platformUserId, { chatState: "idle", clearPending: true });
  await tgSendMessage(
    chatId,
    tFormat("lb_saved", locale, {
      field: fieldLabel(field, locale),
      value: text.trim(),
    }),
  );
  await sendLookbookMenu(chatId, userId, characterId, locale);
}

/** Re-export for tests / docs */
export { FEMALE_LOOKBOOK_FIELDS };
