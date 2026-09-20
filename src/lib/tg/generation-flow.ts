import { listTgFeaturedPhotoTemplates, listTgFeaturedVideoTemplates } from "@/lib/tg/tg-catalog";
import type { TgLocale } from "@/lib/tg/i18n";
import { t, tFormat } from "@/lib/tg/i18n";
import { resolveTemplatePricePeaches } from "@/lib/tg/generation-service";
import { tgSendMessage, tgEditMessageReplyMarkup, tgEditMessageText, tgEditMessageCaption } from "@/lib/tg/telegram-api";
import { isStudioCastCharacter, characterUsesLoraPhoto } from "@/lib/tg/studio-cast";
import { tgMiniAppUrl, tgLoraTrainMiniAppUrl } from "@/lib/tg/miniapp-url";
import { shuffleInPlace } from "@/lib/tg/feed-order";
import type { VideoPickMode } from "@/lib/tg/gen-modes";
import { HUB_CB } from "@/lib/tg/menu";

export const GEN_CB = {
  kindPhoto: "g:k:p",
  kindVideo: "g:k:v",
  /** After «Видео» — pick one-photo vs look catalog */
  videoModeOne: "g:vm:1",
  videoModeLook: "g:vm:l",
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

/** Quality-control callbacks after generation success. */
export const QC_CB = {
  dislike: (itemId: string) => `qc:d:${itemId}`,
  confirm: (itemId: string) => `qc:c:${itemId}`,
  status: (itemId: string) => `qc:s:${itemId}`,
} as const;

export function parseQcDislikeCallback(data: string): string | null {
  if (!data.startsWith("qc:d:")) return null;
  const id = data.slice("qc:d:".length).trim();
  return id || null;
}

export function parseQcConfirmCallback(data: string): string | null {
  if (!data.startsWith("qc:c:")) return null;
  const id = data.slice("qc:c:".length).trim();
  return id || null;
}

export function parseQcStatusCallback(data: string): string | null {
  if (!data.startsWith("qc:s:")) return null;
  const id = data.slice("qc:s:".length).trim();
  return id || null;
}

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
  /** Paginate LoRA model list after video pose confirm */
  loraPage: (page: number) => `vid:lp:${page}`,
  /** Paginate saved video-ref list */
  refPage: (page: number) => `vid:rp:${page}`,
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
  method: (m: string) => `tu:pay:${m}`,
} as const;

/** Template picker: 2 columns × 3 rows, then ◀️ ▶️ on their own row. */
const TEMPLATE_COLS = 2;
const PAGE_SIZE = 6;
/** Longer labels fit when only 2 buttons per row. */
const TEMPLATE_LABEL_MAX = 28;
/** Studio casts on photo confirm: 2 columns × 3 rows */
export const CAST_PAGE_SIZE = 6;
/** Video model / ref lists after pose confirm */
export const VIDEO_CAST_PAGE_SIZE = 6;
const VIDEO_CAST_COLS = 2;

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
  opts?: { videoMode?: VideoPickMode },
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
  let mapped = [
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
  if (opts?.videoMode === "look") {
    mapped = mapped.filter((r) => r.requiresLora);
  } else if (opts?.videoMode === "one_photo") {
    mapped = mapped.filter((r) => !r.requiresLora);
  }
  if (!filter) return mapped;
  const picked = mapped.filter((r) => filter.includes(r.id));
  return picked.length ? picked : mapped;
}

/** Order catalog by session ids; append any new catalog items at the end. */
export function orderTemplatesByIds(
  templates: BotTemplateRow[],
  ids: string[] | null | undefined,
): BotTemplateRow[] {
  if (!ids?.length) return templates;
  const byId = new Map(templates.map((t) => [t.id, t]));
  const out: BotTemplateRow[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    const hit = byId.get(id);
    if (hit) {
      out.push(hit);
      seen.add(id);
    }
  }
  for (const t of templates) {
    if (!seen.has(t.id)) out.push(t);
  }
  return out;
}

function templateButtonLabel(row: BotTemplateRow): string {
  const base = row.title.trim() || row.id.slice(0, 8);
  if (row.requiresLora) {
    return `✨ ${base}`.slice(0, TEMPLATE_LABEL_MAX);
  }
  return base.slice(0, TEMPLATE_LABEL_MAX);
}

function miniAppUrl(): string {
  return tgMiniAppUrl();
}

export function templatePickerKeyboard(
  templates: BotTemplateRow[],
  page: number,
  locale: TgLocale,
  kind: "photo" | "video",
  opts?: { showBack?: boolean },
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
  for (let i = 0; i < slice.length; i += TEMPLATE_COLS) {
    const row: Array<{
      text: string;
      callback_data?: string;
      web_app?: { url: string };
    }> = [];
    for (let j = 0; j < TEMPLATE_COLS && i + j < slice.length; j++) {
      const item = slice[i + j]!;
      row.push({
        text: templateButtonLabel(item),
        callback_data: GEN_CB.pick(kind, safePage * PAGE_SIZE + i + j),
      });
    }
    rows.push(row);
  }

  // Arrow row always below the pose grid (when more than one page).
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

  if (opts?.showBack) {
    rows.push([
      { text: t("hub_btn_back", locale), callback_data: HUB_CB.back },
    ]);
  }

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

/** After video pose confirm: LoRA models or saved refs, paginated like photo cast. */
export function videoModelPickerKeyboard(
  models: BotCastRow[],
  page: number,
  locale: TgLocale,
  mode: "lora" | "ref",
) {
  const totalPages = Math.max(1, Math.ceil(models.length / VIDEO_CAST_PAGE_SIZE));
  const safePage = Math.min(Math.max(0, page), totalPages - 1);
  const slice = models.slice(
    safePage * VIDEO_CAST_PAGE_SIZE,
    safePage * VIDEO_CAST_PAGE_SIZE + VIDEO_CAST_PAGE_SIZE,
  );

  type Btn =
    | { text: string; callback_data: string }
    | { text: string; web_app: { url: string } };
  const rows: Array<Array<Btn>> = [];

  for (let i = 0; i < slice.length; i += VIDEO_CAST_COLS) {
    const row: Array<Btn> = [];
    for (let j = 0; j < VIDEO_CAST_COLS && i + j < slice.length; j++) {
      const m = slice[i + j]!;
      const prefix = mode === "lora" ? "✨ " : "🎬 ";
      row.push({
        text: `${prefix}${m.name}`.slice(0, 32),
        callback_data:
          mode === "lora" ? VID_CB.pickLora(m.id) : VID_CB.pickRef(m.id),
      });
    }
    rows.push(row);
  }

  if (totalPages > 1) {
    const nav: Array<{ text: string; callback_data: string }> = [];
    if (safePage > 0) {
      nav.push({
        text: t("gen_page_prev", locale),
        callback_data:
          mode === "lora"
            ? VID_CB.loraPage(safePage - 1)
            : VID_CB.refPage(safePage - 1),
      });
    }
    if (safePage < totalPages - 1) {
      nav.push({
        text: t("gen_page_next", locale),
        callback_data:
          mode === "lora"
            ? VID_CB.loraPage(safePage + 1)
            : VID_CB.refPage(safePage + 1),
      });
    }
    if (nav.length) rows.push(nav);
  }

  if (mode === "lora") {
    rows.push([
      {
        text: t("video_lora_train_btn", locale),
        web_app: { url: tgLoraTrainMiniAppUrl() },
      },
    ]);
    rows.push([
      { text: t("gen_other_poses_btn", locale), callback_data: GEN_CB.backTemplates },
    ]);
  } else {
    rows.push([
      { text: t("video_ref_upload_new", locale), callback_data: VID_CB.uploadNew },
    ]);
  }

  return { keyboard: rows, page: safePage, totalPages };
}

export async function sendVideoModePicker(chatId: number, locale: TgLocale) {
  await tgSendMessage(chatId, t("gen_video_mode_pick", locale), {
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: t("gen_video_mode_one_btn", locale),
            callback_data: GEN_CB.videoModeOne,
          },
        ],
        [
          {
            text: t("gen_video_mode_look_btn", locale),
            callback_data: GEN_CB.videoModeLook,
          },
        ],
      ],
    },
  });
}

export async function sendTemplatePicker(
  chatId: number,
  userId: string,
  locale: TgLocale,
  kind: "photo" | "video",
  page = 0,
  opts?: {
    editMessageId?: number;
    editHasMedia?: boolean;
    /** Replace caption/text (not only buttons). */
    replaceText?: boolean;
    showBack?: boolean;
    /** Keep this order while paging (no reshuffle). */
    templateIds?: string[];
    /** Fresh shuffle when opening the list (default true if no templateIds). */
    reshuffle?: boolean;
    videoMode?: VideoPickMode;
  },
) {
  let templates = await listBotInlineTemplates(userId, kind, locale, {
    videoMode: opts?.videoMode,
  });
  if (!templates.length) {
    const emptyRows: Array<
      Array<{ text: string; callback_data?: string; web_app?: { url: string } }>
    > = [
      [{ text: t("marketplace_btn", locale), web_app: { url: miniAppUrl() } }],
    ];
    if (opts?.showBack) {
      emptyRows.push([
        { text: t("hub_btn_back", locale), callback_data: HUB_CB.back },
      ]);
    }
    const emptyMarkup = { reply_markup: { inline_keyboard: emptyRows } };
    if (opts?.editMessageId) {
      try {
        if (opts.replaceText) {
          if (opts.editHasMedia) {
            await tgEditMessageCaption(
              chatId,
              opts.editMessageId,
              t("templates_empty", locale),
              emptyMarkup,
            );
          } else {
            await tgEditMessageText(
              chatId,
              opts.editMessageId,
              t("templates_empty", locale),
              emptyMarkup,
            );
          }
        } else {
          await tgEditMessageReplyMarkup(
            chatId,
            opts.editMessageId,
            emptyMarkup.reply_markup,
          );
        }
        return { templates: [], page: 0 };
      } catch {
        /* fall through to send */
      }
    }
    await tgSendMessage(chatId, t("templates_empty", locale), emptyMarkup);
    return { templates: [], page: 0 };
  }

  const shouldShuffle =
    opts?.reshuffle === true ||
    (opts?.reshuffle !== false && !opts?.templateIds?.length);
  if (shouldShuffle) {
    templates = shuffleInPlace([...templates]);
  } else if (opts?.templateIds?.length) {
    templates = orderTemplatesByIds(templates, opts.templateIds);
  }

  const { keyboard, page: safePage } = templatePickerKeyboard(
    templates,
    page,
    locale,
    kind,
    { showBack: opts?.showBack },
  );
  const kindLabel =
    kind === "photo"
      ? t("gen_kind_photo_label", locale)
      : opts?.videoMode === "look"
        ? t("gen_kind_video_look_label", locale)
        : opts?.videoMode === "one_photo"
          ? t("gen_kind_video_one_label", locale)
          : t("gen_kind_video_label", locale);
  const text = tFormat("gen_pick_template", locale, { kind: kindLabel });
  const replyMarkup = { inline_keyboard: keyboard };

  if (opts?.editMessageId) {
    try {
      if (opts.replaceText) {
        if (opts.editHasMedia) {
          await tgEditMessageCaption(chatId, opts.editMessageId, text, {
            reply_markup: replyMarkup,
          });
        } else {
          await tgEditMessageText(chatId, opts.editMessageId, text, {
            reply_markup: replyMarkup,
          });
        }
      } else {
        // Same caption on every page — only swap buttons in-place.
        await tgEditMessageReplyMarkup(chatId, opts.editMessageId, replyMarkup);
      }
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
  /** What we actually charge now. */
  price: number;
  label: string;
  discountApplied: boolean;
  freePhoto: boolean;
  studioDaily?: boolean;
  loraWelcome?: boolean;
}> {
  await import("@/lib/ops/prices").then(({ ensurePriceOverlay }) =>
    ensurePriceOverlay(),
  );
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
    const { priceForPhotoCharacter } = await import("@/lib/template-pricing");
    if (isStudioCastCharacter(opts.character)) {
      basePrice = priceForPhotoCharacter({ isStudioCast: true });
    } else if (characterUsesLoraPhoto(opts.character)) {
      basePrice = priceForPhotoCharacter({ isStudioCast: false });
    }
  }

  const baseLabel = tFormat("gen_confirm_price", opts.locale, {
    price: basePrice,
  });

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

export function successInlineKeyboard(
  locale: TgLocale,
  opts?: {
    kind?: "photo" | "video";
    galleryItemId?: string;
    qcStatus?: "idle" | "pending" | "approved" | "rejected";
  },
) {
  const rows: Array<Array<{ text: string; callback_data: string }>> = [
    [{ text: t("gen_again_photo_btn", locale), callback_data: GEN_CB.againPhoto }],
    [{ text: t("gen_again_video_btn", locale), callback_data: GEN_CB.againVideo }],
    [{ text: t("gen_to_hub_btn", locale), callback_data: GEN_CB.toHub }],
  ];

  const itemId = opts?.galleryItemId?.trim();
  const kind = opts?.kind;
  const qcStatus = opts?.qcStatus || "idle";
  if (itemId && kind) {
    if (qcStatus === "pending") {
      rows.push([
        {
          text: t("qc_btn_pending", locale),
          callback_data: QC_CB.status(itemId),
        },
      ]);
    } else if (qcStatus === "approved") {
      rows.push([
        {
          text: t("qc_btn_approved", locale),
          callback_data: QC_CB.status(itemId),
        },
      ]);
    } else if (qcStatus === "rejected") {
      rows.push([
        {
          text: t("qc_btn_rejected", locale),
          callback_data: QC_CB.status(itemId),
        },
      ]);
    } else {
      rows.push([
        {
          text:
            kind === "video"
              ? t("qc_dislike_video_btn", locale)
              : t("qc_dislike_photo_btn", locale),
          callback_data: QC_CB.dislike(itemId),
        },
      ]);
    }
  }

  return { inline_keyboard: rows };
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
