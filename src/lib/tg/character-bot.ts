import type { TgLocale } from "@/lib/tg/i18n";
import { t, tFormat } from "@/lib/tg/i18n";
import { prisma } from "@/lib/db";
import {
  TG_MAX_CHARACTER_PHOTOS,
  TG_MIN_CHARACTER_PHOTOS,
  characterPhotoCount,
  characterReady,
  createTgCharacter,
  listTgCharacters,
  renameTgCharacter,
  setActiveTgCharacter,
} from "@/lib/tg/character-service";
import { setTgSession } from "@/lib/tg/session";
import { tgSendMessage } from "@/lib/tg/telegram-api";

export const CB = {
  lang: (locale: TgLocale) => `lang:${locale}`,
  rulesAgree: "rules:agree",
  charSelect: (id: string) => `char:sel:${id}`,
  charNew: "char:new",
  charBack: "char:back",
  charAddPhotos: (id: string) => `char:ph:${id}`,
  charRename: (id: string) => `char:ren:${id}`,
  charLookbook: (id: string) => `char:lb:${id}`,
} as const;

export function parseLangCb(data: string): TgLocale | null {
  if (data === "lang:ru") return "ru";
  if (data === "lang:en") return "en";
  return null;
}

export function langInlineKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: "🇷🇺 Русский", callback_data: CB.lang("ru") },
        { text: "🇺🇸 English", callback_data: CB.lang("en") },
      ],
    ],
  };
}

export async function sendCharactersList(
  chatId: number,
  userId: string,
  platformUserId: string,
  locale: TgLocale,
) {
  const chars = await listTgCharacters(userId);
  const acc = await prisma.platformAccount.findUnique({
    where: {
      platform_platformUserId: {
        platform: "telegram",
        platformUserId,
      },
    },
  });
  const activeId = acc?.activeCharacterId;

  const rows: Array<Array<{ text: string; callback_data: string }>> = [];
  for (const ch of chars) {
    const mark = ch.id === activeId ? " ✓" : "";
    const n = characterPhotoCount(ch.id);
    rows.push([
      {
        text: `${ch.name}${mark} (${n}/${TG_MAX_CHARACTER_PHOTOS})`,
        callback_data: CB.charSelect(ch.id),
      },
    ]);
  }
  rows.push([{ text: t("char_new_btn", locale), callback_data: CB.charNew }]);

  await tgSendMessage(chatId, t("char_list_title", locale), {
    reply_markup: { inline_keyboard: rows },
  });
}

export async function sendCharacterDetail(
  chatId: number,
  userId: string,
  characterId: string,
  locale: TgLocale,
) {
  const ch = await listTgCharacters(userId).then((list) =>
    list.find((c) => c.id === characterId),
  );
  if (!ch) {
    await tgSendMessage(chatId, t("char_not_found", locale));
    return;
  }

  const n = characterPhotoCount(ch.id);
  const ready = characterReady(ch.id);
  const body = tFormat("char_detail", locale, {
    name: ch.name,
    n,
    max: TG_MAX_CHARACTER_PHOTOS,
    ready: ready ? t("model_ready_suffix", locale) : "",
    min: TG_MIN_CHARACTER_PHOTOS,
  });

  await tgSendMessage(chatId, body, {
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: t("char_add_photos_btn", locale),
            callback_data: CB.charAddPhotos(ch.id),
          },
        ],
        [
          {
            text: t("char_rename_btn", locale),
            callback_data: CB.charRename(ch.id),
          },
        ],
        [
          {
            text: t("char_lookbook_btn", locale),
            callback_data: CB.charLookbook(ch.id),
          },
        ],
        [{ text: t("char_back_btn", locale), callback_data: CB.charBack }],
      ],
    },
  });
}

export async function handleCharacterCallback(
  chatId: number,
  platformUserId: string,
  userId: string,
  locale: TgLocale,
  data: string,
): Promise<boolean> {
  if (data === CB.charNew) {
    await setTgSession(platformUserId, {
      chatState: "awaiting_character_name",
      clearPending: true,
    });
    await tgSendMessage(chatId, t("char_name_prompt", locale));
    return true;
  }

  if (data === CB.charBack) {
    await setTgSession(platformUserId, { chatState: "idle" });
    await sendCharactersList(chatId, userId, platformUserId, locale);
    return true;
  }

  if (data.startsWith("char:sel:")) {
    const id = data.slice("char:sel:".length);
    const ch = await listTgCharacters(userId).then((l) =>
      l.find((c) => c.id === id),
    );
    if (!ch) {
      await tgSendMessage(chatId, t("char_not_found", locale));
      return true;
    }
    await setActiveTgCharacter(platformUserId, id);
    await sendCharacterDetail(chatId, userId, id, locale);
    return true;
  }

  if (data.startsWith("char:ph:")) {
    const id = data.slice("char:ph:".length);
    await setActiveTgCharacter(platformUserId, id);
    await setTgSession(platformUserId, { chatState: "awaiting_photos" });
    await tgSendMessage(chatId, t("upload_photos", locale));
    return true;
  }

  if (data.startsWith("char:ren:")) {
    const id = data.slice("char:ren:".length);
    await setTgSession(platformUserId, {
      chatState: "awaiting_character_rename",
      pending: { renameCharacterId: id },
    });
    await tgSendMessage(chatId, t("char_rename_prompt", locale));
    return true;
  }

  if (data.startsWith("char:lb:")) {
    const id = data.slice("char:lb:".length);
    const { sendLookbookMenu } = await import("@/lib/tg/lookbook-bot");
    await sendLookbookMenu(chatId, userId, id, locale);
    return true;
  }

  return false;
}

export async function handleCharacterTextInput(
  chatId: number,
  platformUserId: string,
  userId: string,
  locale: TgLocale,
  chatState: string,
  text: string,
  pending: { renameCharacterId?: string },
): Promise<boolean> {
  if (chatState === "awaiting_character_name") {
    const ch = await createTgCharacter(userId, text);
    await setActiveTgCharacter(platformUserId, ch.id);
    await setTgSession(platformUserId, { chatState: "idle" });
    await tgSendMessage(
      chatId,
      tFormat("char_created", locale, { name: ch.name }),
    );
    await sendCharacterDetail(chatId, userId, ch.id, locale);
    return true;
  }

  if (chatState === "awaiting_character_rename" && pending.renameCharacterId) {
    await renameTgCharacter(userId, pending.renameCharacterId, text);
    await setTgSession(platformUserId, { chatState: "idle", clearPending: true });
    await sendCharacterDetail(
      chatId,
      userId,
      pending.renameCharacterId,
      locale,
    );
    return true;
  }

  return false;
}
