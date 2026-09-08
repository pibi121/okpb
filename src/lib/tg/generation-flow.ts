import { listTgFeaturedPhotoTemplates, listTgFeaturedVideoTemplates } from "@/lib/tg/tg-catalog";
import type { TgLocale } from "@/lib/tg/i18n";
import { t, tFormat } from "@/lib/tg/i18n";
import { resolveTemplatePricePeaches } from "@/lib/tg/generation-service";
import { tgSendMessage, tgEditMessageReplyMarkup } from "@/lib/tg/telegram-api";
import { isStudioCastCharacter, characterUsesLoraPhoto } from "@/lib/tg/studio-cast";
import {
  canUseStudioDailyFree,
} from "@/lib/tg/tg-promo";

export const GEN_CB = {
  kindPhoto: "g:k:p",
  kindVideo: "g:k:v",
  /** Index pick — kind baked into callback so session can't swap photo/video. */
  pick: (kind: "photo" | "video", idx: number) =>
    `g:pi:${kind === "video" ? "v" : "p"}:${idx}`,
  page: (kind: "photo" | "video", page: number) =>
    `g:pg:${kind === "video" ? "v" : "p"}:${page}`,
  pickCast: (id: string) => `g:mc:${id}`,
  castPage: (page: number) => `g:cp:${page}`,
  confirm: "g:go",
  backTemplates: "g:bt",
  againPhoto: "g:ap",
  againVideo: "g:av",
  toHub: "g:hub",
} as const;

export function parseGenPickCallback(data: string): {
  kind: "photo" | "video" | null;
  idx: number;
} | null {
  if (!data.startsWith("g:pi:")) return null;
  const rest = data.slice("g:pi:".length);
  if (rest.startsWith("v:") || rest.startsWith("p:")) {
    return {
      kind: rest.startsWith("v:") ? "video" : "photo",
      idx: Number(rest.slice(2)) || 0,
    };
  }
  // Legacy buttons without kind prefix
  return { kind: null, idx: Number(rest) || 0 };
}

export function parseGenPageCallback(data: string): {
  kind: "photo" | "video" | null;
  page: number;
} | null {
  if (!data.startsWith("g:pg:")) return null;
  const rest = data.slice("g:pg:".length);
  if (rest.startsWith("v:") || rest.startsWith("p:")) {
    return {
      kind: rest.startsWith("v:") ? "video" : "photo",
      page: Number(rest.slice(2)) || 0,
    };
  }
  return { kind: null, page: Number(rest) || 0 };
}

export const VID_CB = {
  pickRef: (id: string) => `vid:ref:${id}`,
  pickLora: (id: string) => `vid:lora:${id}`,
  trainLora: "vid:train",
  uploadNew: "vid:new",
  photosDone: "vid:done",
  saveYes: (id: string) => `vid:save:${id}`,
  saveSkip: "vid:skip",
} as const;

export const OB_CB = {
  uploadChar: "ob:up",
  backName: "ob:bn",
  kindPhoto: "ob:kp",
  kindVideo: "ob:kv",
  pickStudio: (id: string) => `ob:sc:${id}`,
  /** Retry LoRA train after top-up (character already has 5+ photos). */
  payTrain: (characterId: string) => `ob:pt:${characterId}`,
} as const;

export const TOPUP_CB = {
  amount: (n: number) => `tu:${n}`,
} as const;

const PAGE_SIZE = 6;
/** Studio casts on photo confirm: 2 columns × 3 rows */
export const CAST_PAGE_SIZE = 6;

export type BotTemplateRow = {
  id: string;
  title: string;
  kind: "photo" | "video";
  requiresLora?: boolean;
};

function botTemplateFilter(): string[] | null {
  const raw = process.env.TG_BOT_INLINE_TEMPLATE_IDS?.trim();
  if (!raw) return null;
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

export async function listBotInlineTemplates(
  userId: string,
  kind: "photo" | "video",
  locale: TgLocale,
): Promise<BotTemplateRow[]> {
  if (kind === "photo") {
    const rows = await listTgFeaturedPhotoTemplates(locale);
    return rows.map((r) => ({ id: r.id, title: r.title, kind: "photo" as const }));
  }
  const [rows, loraI2v] = await Promise.all([
    listTgFeaturedVideoTemplates(userId),
    import("@/lib/lora-i2v-template").then((m) =>
      m.listTgPublishedLoraI2vTemplates(locale),
    ),
  ]);
  const filter = botTemplateFilter();
  const mapped = [
    ...loraI2v.map((r) => ({
      id: r.id,
      title: r.title,
      kind: "video" as const,
      requiresLora: true,
    })),
    ...rows.map((r) => ({
      id: r.id,
      title: r.title,
      kind: "video" as const,
      requiresLora: false,
    })),
  ];
  if (!filter) return mapped;
  const picked = mapped.filter((r) => filter.includes(r.id));
  return picked.length ? picked : mapped;
}

import { tgMiniAppUrl } from "@/lib/tg/miniapp-url";

function miniAppUrl(): string {
  return tgMiniAppUrl();
}

export function templatePickerKeyboard(
  templates: BotTemplateRow[],
  page: number,
  locale: TgLocale,
  kind: "photo" | "video",
) {
  const totalPages = Math.max(1, Math.ceil(templates.length / PAGE_SIZE));
  const safePage = Math.min(Math.max(0, page), totalPages - 1);
  const slice = templates.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  const rows: Array<
    Array<{
      text: string;
      callback_data?: string;
      web_app?: { url: string };
    }>
  > = [];
  for (let i = 0; i < slice.length; i += 2) {
    const row: Array<{
      text: string;
      callback_data?: string;
      web_app?: { url: string };
    }> = [];
    const a = slice[i]!;
    const aLabel = a.requiresLora
      ? `✨ ${a.title}`.slice(0, 40)
      : a.title.slice(0, 40);
    row.push({
      text: aLabel,
      callback_data: GEN_CB.pick(kind, safePage * PAGE_SIZE + i),
    });
    const b = slice[i + 1];
    if (b) {
      const bLabel = b.requiresLora
        ? `✨ ${b.title}`.slice(0, 40)
        : b.title.slice(0, 40);
      row.push({
        text: bLabel,
        callback_data: GEN_CB.pick(kind, safePage * PAGE_SIZE + i + 1),
      });
    }
    rows.push(row);
  }

  if (totalPages > 1) {
    const nav: Array<{ text: string; callback_data: string }> = [];
    if (safePage > 0)
      nav.push({
        text: t("gen_page_prev", locale),
        callback_data: GEN_CB.page(kind, safePage - 1),
      });
    if (safePage < totalPages - 1)
      nav.push({
        text: t("gen_page_next", locale),
        callback_data: GEN_CB.page(kind, safePage + 1),
      });
    if (nav.length) rows.push(nav);
  }

  rows.push([
    {
      text: t("marketplace_btn", locale),
      web_app: { url: miniAppUrl() },
    },
  ]);

  return { keyboard: rows, page: safePage, totalPages };
}

export type BotCastRow = { id: string; name: string };

export function photoCastPickerKeyboard(
  casts: BotCastRow[],
  selectedId: string | null | undefined,
  page: number,
  locale: TgLocale,
  opts?: { canAfford?: boolean },
) {
  const totalPages = Math.max(1, Math.ceil(casts.length / CAST_PAGE_SIZE));
  const safePage = Math.min(Math.max(0, page), totalPages - 1);
  const slice = casts.slice(
    safePage * CAST_PAGE_SIZE,
    safePage * CAST_PAGE_SIZE + CAST_PAGE_SIZE,
  );

  const rows: Array<Array<{ text: string; callback_data: string }>> = [];
  for (let i = 0; i < slice.length; i += 2) {
    const row: Array<{ text: string; callback_data: string }> = [];
    const a = slice[i]!;
    const aMark = a.id === selectedId ? " ✓" : "";
    row.push({
      text: `${a.name.slice(0, 28)}${aMark}`,
      callback_data: GEN_CB.pickCast(a.id),
    });
    const b = slice[i + 1];
    if (b) {
      const bMark = b.id === selectedId ? " ✓" : "";
      row.push({
        text: `${b.name.slice(0, 28)}${bMark}`,
        callback_data: GEN_CB.pickCast(b.id),
      });
    }
    rows.push(row);
  }

  if (totalPages > 1) {
    const nav: Array<{ text: string; callback_data: string }> = [];
    if (safePage > 0) {
      nav.push({
        text: t("gen_page_prev", locale),
        callback_data: GEN_CB.castPage(safePage - 1),
      });
    }
    if (safePage < totalPages - 1) {
      nav.push({
        text: t("gen_page_next", locale),
        callback_data: GEN_CB.castPage(safePage + 1),
      });
    }
    if (nav.length) rows.push(nav);
  }

  if (opts?.canAfford === false) {
    rows.push([{ text: t("topup_btn", locale), callback_data: "tu:open" }]);
  } else {
    rows.push([
      { text: t("gen_confirm_btn", locale), callback_data: GEN_CB.confirm },
    ]);
  }
  rows.push([{ text: t("gen_other_poses_btn", locale), callback_data: GEN_CB.backTemplates }]);

  return { keyboard: rows, page: safePage, totalPages };
}

export async function sendTemplatePicker(
  chatId: number,
  userId: string,
  locale: TgLocale,
  kind: "photo" | "video",
  page = 0,
  opts?: { editMessageId?: number },
) {
  const templates = await listBotInlineTemplates(userId, kind, locale);
  if (!templates.length) {
    const emptyMarkup = {
      reply_markup: {
        inline_keyboard: [
          [{ text: t("marketplace_btn", locale), web_app: { url: miniAppUrl() } }],
        ],
      },
    };
    if (opts?.editMessageId) {
      try {
        await tgEditMessageReplyMarkup(chatId, opts.editMessageId, emptyMarkup.reply_markup);
        return { templates: [], page: 0 };
      } catch {
        /* fall through to send */
      }
    }
    await tgSendMessage(chatId, t("templates_empty", locale), emptyMarkup);
    return { templates: [], page: 0 };
  }

  const { keyboard, page: safePage } = templatePickerKeyboard(
    templates,
    page,
    locale,
    kind,
  );
  const kindLabel =
    kind === "photo" ? t("gen_kind_photo_label", locale) : t("gen_kind_video_label", locale);
  const text = tFormat("gen_pick_template", locale, { kind: kindLabel });
  const replyMarkup = { inline_keyboard: keyboard };

  if (opts?.editMessageId) {
    try {
      // Same caption on every page — only swap buttons in-place.
      await tgEditMessageReplyMarkup(chatId, opts.editMessageId, replyMarkup);
      return { templates, page: safePage };
    } catch {
      /* message gone / too old — send a fresh one */
    }
  }

  await tgSendMessage(chatId, text, {
    reply_markup: replyMarkup,
  });

  return { templates, page: safePage };
}

export async function resolvePickIndex(
  userId: string,
  kind: "photo" | "video",
  locale: TgLocale,
  idx: number,
  cachedIds?: string[] | null,
): Promise<BotTemplateRow | null> {
  if (cachedIds?.length) {
    const id = cachedIds[idx];
    if (id) {
      const templates = await listBotInlineTemplates(userId, kind, locale);
      const hit = templates.find((t) => t.id === id);
      if (hit) return hit;
      // Id from picker session — trust kind even if not in current featured list
      return { id, title: id.slice(0, 12), kind };
    }
  }
  const templates = await listBotInlineTemplates(userId, kind, locale);
  return templates[idx] ?? null;
}

export async function templatePriceLabel(opts: {
  userId: string;
  kind: "photo" | "video";
  templateId: string;
  locale: TgLocale;
  character?: {
    id?: string;
    isStudioCast?: boolean;
    loraStatus?: string;
    userId?: string;
  } | null;
}): Promise<{
  /** Catalog / ops price before promos — always show this to the user. */
  basePrice: number;
  /** What we actually charge now (0 only for verified free promos). */
  price: number;
  label: string;
  discountApplied: boolean;
  freePhoto: boolean;
  studioDaily?: boolean;
  loraWelcome?: boolean;
}> {
  const { prisma } = await import("@/lib/db");
  const user = await prisma.user.findUnique({ where: { id: opts.userId } });

  let basePrice = await resolveTemplatePricePeaches({
    kind: opts.kind,
    templateId: opts.templateId,
    userId: opts.userId,
    characterId: opts.character?.id,
  });
  if (!(basePrice > 0)) {
    basePrice = 1;
  }

  if (opts.kind === "photo" && opts.character && !opts.character.id) {
    const { photoActressPeaches, photoLoraPeaches } = await import(
      "@/lib/tg-pricing"
    );
    const { getPhotoTemplate } = await import("@/lib/photo-template");
    const row = await getPhotoTemplate(opts.templateId);
    if (!row || !(row.pricePeaches > 0)) {
      if (isStudioCastCharacter(opts.character)) {
        basePrice = Math.max(1, photoActressPeaches());
      } else if (characterUsesLoraPhoto(opts.character)) {
        basePrice = Math.max(1, photoLoraPeaches());
      }
    }
  }

  const baseLabel = tFormat("gen_confirm_price", opts.locale, {
    price: basePrice,
  });

  if (opts.kind === "photo" && opts.character) {
    if (isStudioCastCharacter(opts.character)) {
      if (await canUseStudioDailyFree(opts.userId)) {
        return {
          basePrice,
          price: 0,
          label: `${baseLabel}\n${t("studio_free_daily_note", opts.locale)}`,
          discountApplied: false,
          freePhoto: true,
          studioDaily: true,
        };
      }
    } else if (characterUsesLoraPhoto(opts.character)) {
      const left = user?.tgLoraWelcomePhotosLeft ?? 0;
      if (left > 0) {
        const leftNote =
          left > 1
            ? `\n${tFormat("lora_welcome_photos_left", opts.locale, { n: left })}`
            : "";
        return {
          basePrice,
          price: 0,
          label:
            `${baseLabel}\n${t("gen_confirm_free_note", opts.locale)}` +
            leftNote,
          discountApplied: false,
          freePhoto: true,
          loraWelcome: true,
        };
      }
    }
  }

  if (opts.kind === "video" && user && !user.tgFirstVideoDiscountUsed && basePrice > 0) {
    const { applyFirstVideoDiscount } = await import("@/lib/tg-pricing");
    const d = applyFirstVideoDiscount(basePrice, false);
    if (d.discountApplied) {
      return {
        basePrice,
        price: d.peaches,
        label: tFormat("gen_confirm_discount", opts.locale, {
          price: d.peaches,
          base: basePrice,
        }),
        discountApplied: true,
        freePhoto: false,
      };
    }
  }

  return {
    basePrice,
    price: basePrice,
    label: baseLabel,
    discountApplied: false,
    freePhoto: false,
  };
}

export function successInlineKeyboard(locale: TgLocale) {
  return {
    inline_keyboard: [
      [{ text: t("gen_again_photo_btn", locale), callback_data: GEN_CB.againPhoto }],
      [{ text: t("gen_again_video_btn", locale), callback_data: GEN_CB.againVideo }],
      [{ text: t("gen_to_hub_btn", locale), callback_data: GEN_CB.toHub }],
    ],
  };
}

export function genKindInlineKeyboard(locale: TgLocale) {
  return {
    inline_keyboard: [
      [
        { text: t("gen_kind_photo_btn", locale), callback_data: GEN_CB.kindPhoto },
        { text: t("gen_kind_video_btn", locale), callback_data: GEN_CB.kindVideo },
      ],
    ],
  };
}

export function onboardKindInlineKeyboard(locale: TgLocale) {
  return {
    inline_keyboard: [
      [
        { text: t("gen_kind_photo_btn", locale), callback_data: OB_CB.kindPhoto },
        { text: t("gen_kind_video_btn", locale), callback_data: OB_CB.kindVideo },
      ],
    ],
  };
}
