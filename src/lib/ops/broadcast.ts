import { prisma } from "@/lib/db";
import {
  tgSendMessage,
} from "@/lib/tg/telegram-api";
import { normalizeLocale } from "@/lib/tg/i18n";
import { saveOpsSettings } from "@/lib/ops/settings";
import { tgMiniAppUrl } from "@/lib/tg/miniapp-url";
import { listLiveBots, type LiveBot } from "@/lib/tg/bot-registry";
import { tgDeliverPhoto, tgDeliverVideo } from "@/lib/tg/deliver-media";

export type BroadcastFilter = {
  who?: "all" | "paid" | "never_paid" | "no_job" | "pre_funnel_v2";
  locale?: "ru" | "en" | "";
  trafficLinkId?: string;
  skipQuietDays?: number;
  /**
   * Which active bots to send through.
   * Omit / empty = all active (dual fan-out).
   * Standby/banned never included — callbacks would be dead there.
   */
  botIds?: string[];
};

export type BroadcastBotStat = {
  botId: string;
  username: string;
  sent: number;
  fail: number;
};

export type BroadcastBotStatsMap = Record<string, BroadcastBotStat>;

export type BroadcastMediaItem = {
  type: "photo" | "video";
  url: string;
};

/** Telegram inline button accent (Bot API style). */
export type BroadcastButtonStyle = "default" | "success" | "danger" | "primary";

/**
 * Broadcast CTA button.
 * - Default: Mini App web_app via `path` under /tg/
 * - In-bot: `path` like `bot:photo` (allowlisted → Funnel v2 callback, no Mini App)
 */
export type BroadcastButton = {
  text: string;
  /** Mini App path under /tg/, or `bot:<key>` for in-bot callback. */
  path: string;
  /** Optional TG button color (success=green, danger=red, primary=blue). */
  style?: Exclude<BroadcastButtonStyle, "default">;
};

/**
 * Allowlisted in-bot section keys → Funnel v2 callbacks (same as main hub).
 * Template deep links use `bot:pt:<id>` / `bot:vt:<id>` → `bc:pt|vt:<id>`.
 */
export const BROADCAST_BOT_ACTIONS: Record<string, string> = {
  /** Same entry as hub «Раздеть и сделать фото» */
  photo: "fv2:ph",
  undress: "fv2:ph",
  /** Same entry as hub «Сделать горячее видео» */
  video: "fv2:vid",
  video_look: "fv2:vid",
  video_one: "fv2:vid",
  topup: "fv2:tu",
  help: "fv2:help",
  earn: "fv2:earn",
  hub: "fv2:hub",
  /** Explicit aliases */
  make_photo: "fv2:ph",
  make_video: "fv2:vid",
};

/** Prisma cuid-ish ids only — never pass arbitrary callback_data. */
const TEMPLATE_ID_RE = /^[a-z][a-z0-9]{7,39}$/i;

export function resolveBroadcastBotCallback(path: string): string | null {
  const p = path.trim().replace(/^\//, "");
  if (!p.startsWith("bot:")) return null;
  const rest = p.slice(4).trim();
  const tmpl = rest.match(/^(pt|vt):(.+)$/i);
  if (tmpl) {
    const kind = tmpl[1].toLowerCase();
    const id = tmpl[2].trim();
    if (!TEMPLATE_ID_RE.test(id)) return null;
    const cb = `bc:${kind}:${id}`;
    // Telegram callback_data hard limit.
    if (cb.length > 64) return null;
    return cb;
  }
  const key = rest.toLowerCase();
  return BROADCAST_BOT_ACTIONS[key] || null;
}

export type BroadcastButtonOption = {
  text: string;
  path: string;
  group: "bot" | "miniapp" | "photo" | "video";
  subtitle?: string;
};

/** Hub sections for the ops picker — labels match Funnel v2 main menu. */
export const BROADCAST_BOT_SECTION_OPTIONS: BroadcastButtonOption[] = [
  {
    text: "💦 Раздеть и сделать фото 💦",
    path: "bot:photo",
    group: "bot",
    subtitle: "как в главном меню → fv2:ph",
  },
  {
    text: "🍓 Сделать горячее видео 🍓",
    path: "bot:video",
    group: "bot",
    subtitle: "как в главном меню → fv2:vid",
  },
  { text: "Баланс и пополнение", path: "bot:topup", group: "bot" },
  { text: "🤑 Заработать", path: "bot:earn", group: "bot" },
  { text: "ℹ️ Помощь", path: "bot:help", group: "bot" },
  { text: "Главное меню", path: "bot:hub", group: "bot" },
];

export const BROADCAST_MINIAPP_OPTIONS: BroadcastButtonOption[] = [
  { text: "Лента", path: "", group: "miniapp" },
  { text: "Фото (мини-апп)", path: "photo", group: "miniapp" },
  { text: "Видео (мини-апп)", path: "video", group: "miniapp" },
  { text: "Витрина моделей", path: "characters", group: "miniapp" },
  { text: "Обучить свою", path: "characters?section=train", group: "miniapp" },
  { text: "Галерея", path: "gallery", group: "miniapp" },
  { text: "Пополнить (мини-апп)", path: "topup", group: "miniapp" },
  { text: "Гайд", path: "guide", group: "miniapp" },
  { text: "Профиль", path: "profile", group: "miniapp" },
];

/** Full catalog for /ops/broadcasts picker (sections + published templates). */
export async function listBroadcastButtonCatalog(): Promise<
  BroadcastButtonOption[]
> {
  const [photos, videos, lora] = await Promise.all([
    prisma.photoTemplate.findMany({
      where: { tgPublished: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
      select: {
        id: true,
        title: true,
        tgDisplayTitle: true,
        sceneCategory: true,
      },
    }),
    prisma.quickVideoTemplate.findMany({
      where: { tgPublished: true },
      orderBy: [{ tgSortOrder: "asc" }, { updatedAt: "desc" }],
      select: {
        id: true,
        title: true,
        tgDisplayTitle: true,
      },
    }),
    prisma.loraI2vTemplate.findMany({
      where: { tgPublished: true },
      orderBy: [{ tgSortOrder: "asc" }, { updatedAt: "desc" }],
      select: {
        id: true,
        title: true,
        tgDisplayTitle: true,
      },
    }),
  ]);

  const photoOpts: BroadcastButtonOption[] = photos.map((r) => {
    const title = (r.tgDisplayTitle.trim() || r.title).slice(0, 64);
    return {
      text: title,
      path: `bot:pt:${r.id}`,
      group: "photo",
      subtitle: r.sceneCategory || undefined,
    };
  });

  const videoOpts: BroadcastButtonOption[] = [
    ...videos.map((r) => {
      const title = (r.tgDisplayTitle.trim() || r.title).slice(0, 64);
      return {
        text: title,
        path: `bot:vt:${r.id}`,
        group: "video" as const,
        subtitle: "quick",
      };
    }),
    ...lora.map((r) => {
      const title = (r.tgDisplayTitle.trim() || r.title).slice(0, 64);
      return {
        text: title,
        path: `bot:vt:${r.id}`,
        group: "video" as const,
        subtitle: "best / LoRA",
      };
    }),
  ];

  return [
    ...BROADCAST_BOT_SECTION_OPTIONS,
    ...BROADCAST_MINIAPP_OPTIONS,
    ...photoOpts,
    ...videoOpts,
  ];
}

function parseFilter(raw: string): BroadcastFilter {
  try {
    const v = JSON.parse(raw || "{}") as BroadcastFilter;
    const botIds = Array.isArray(v.botIds)
      ? v.botIds.filter((x): x is string => typeof x === "string" && x.trim().length > 0)
      : undefined;
    return { ...v, ...(botIds?.length ? { botIds } : {}) };
  } catch {
    return {};
  }
}

function emptyBotStats(bots: LiveBot[]): BroadcastBotStatsMap {
  const out: BroadcastBotStatsMap = {};
  for (const b of bots) {
    const key = `@${b.username || b.id}`;
    out[key] = { botId: b.id, username: b.username || b.id, sent: 0, fail: 0 };
  }
  return out;
}

function totalsFromBotStats(stats: BroadcastBotStatsMap) {
  let sent = 0;
  let fail = 0;
  for (const s of Object.values(stats)) {
    sent += s.sent;
    fail += s.fail;
  }
  return { sent, fail };
}

/** Active dual bots for fan-out (standby/banned excluded — no full callback handling). */
export async function resolveBroadcastTargetBots(
  filter?: BroadcastFilter,
): Promise<LiveBot[]> {
  const live = await listLiveBots();
  if (!live.length) {
    throw new Error(
      "Нет активных ботов для рассылки. Проверь /ops/bot и TELEGRAM_BOT_TOKEN.",
    );
  }
  const want = filter?.botIds?.filter(Boolean);
  if (!want?.length) return live;
  const set = new Set(want);
  const picked = live.filter((b) => set.has(b.id));
  if (!picked.length) {
    throw new Error(
      "Выбранные боты не активны (или id устарели). Выбери активных в /ops/bot.",
    );
  }
  return picked;
}

export async function listBroadcastBotOptions(): Promise<
  Array<{ id: string; username: string; isPrimary: boolean }>
> {
  const live = await listLiveBots();
  return live.map((b) => ({
    id: b.id,
    username: b.username || b.id,
    isPrimary: b.isPrimary,
  }));
}

function parseMediaJson(raw: string, legacyUrl?: string): BroadcastMediaItem[] {
  try {
    const v = JSON.parse(raw || "[]") as BroadcastMediaItem[];
    if (Array.isArray(v) && v.length) {
      return v
        .filter((m) => m?.url?.trim())
        .slice(0, 2)
        .map((m) => ({
          type: m.type === "video" ? "video" : "photo",
          url: m.url.trim(),
        }));
    }
  } catch {
    /* ignore */
  }
  if (legacyUrl?.trim()) {
    const u = legacyUrl.trim();
    const isVideo = /\.(mp4|webm|mov)(\?|$)/i.test(u);
    return [{ type: isVideo ? "video" : "photo", url: u }];
  }
  return [];
}

function normalizeButtonStyle(
  raw: unknown,
): Exclude<BroadcastButtonStyle, "default"> | undefined {
  if (typeof raw !== "string") return undefined;
  const s = raw.trim().toLowerCase();
  if (s === "success" || s === "danger" || s === "primary") return s;
  return undefined;
}

function parseButtonsJson(raw: string): BroadcastButton[] {
  try {
    const v = JSON.parse(raw || "[]") as BroadcastButton[];
    if (!Array.isArray(v)) return [];
    const out: BroadcastButton[] = [];
    for (const b of v.slice(0, 6)) {
      if (!b?.text?.trim() || typeof b.path !== "string") continue;
      const path = b.path.trim().replace(/^\//, "");
      // Drop unknown bot: keys — never send arbitrary callback_data.
      if (path.startsWith("bot:") && !resolveBroadcastBotCallback(path)) {
        continue;
      }
      const style = normalizeButtonStyle(b.style);
      out.push({
        text: b.text.trim().slice(0, 64),
        path,
        ...(style ? { style } : {}),
      });
    }
    return out;
  } catch {
    return [];
  }
}

type InlineBtn = {
  text: string;
  web_app?: { url: string };
  callback_data?: string;
  style?: "success" | "danger" | "primary";
};

function buttonsMarkup(buttons: BroadcastButton[]) {
  if (!buttons.length) return undefined;
  const rows: InlineBtn[][] = [];
  for (let i = 0; i < buttons.length; i += 2) {
    const row = buttons.slice(i, i + 2).map((b): InlineBtn => {
      const style = normalizeButtonStyle(b.style);
      const cb = resolveBroadcastBotCallback(b.path);
      if (cb) {
        return {
          text: b.text,
          callback_data: cb,
          ...(style ? { style } : {}),
        };
      }
      return {
        text: b.text,
        web_app: { url: tgMiniAppUrl(b.path.replace(/^\//, "")) },
        ...(style ? { style } : {}),
      };
    });
    rows.push(row);
  }
  return { inline_keyboard: rows };
}

export async function previewBroadcastAudience(filterJson: string) {
  const f = parseFilter(filterJson);
  const where = await buildWhere(f);
  return prisma.platformAccount.count({ where });
}

async function buildWhere(f: BroadcastFilter) {
  const quietFrom =
    f.skipQuietDays && f.skipQuietDays > 0
      ? new Date(Date.now() - f.skipQuietDays * 86400000)
      : null;

  let createdBefore: Date | null = null;
  if (f.who === "pre_funnel_v2") {
    const { getOpsSettings } = await import("@/lib/ops/settings");
    const s = await getOpsSettings();
    if (s.tgFunnelV2LiveAt) {
      createdBefore = new Date(s.tgFunnelV2LiveAt);
    } else {
      // Go-live not frozen yet — preview ≈ current base (everyone so far).
      createdBefore = new Date();
    }
  }

  return {
    platform: "telegram" as const,
    user: {
      blocked: false,
      ...(f.locale ? { locale: f.locale } : {}),
      ...(f.trafficLinkId ? { trafficLinkId: f.trafficLinkId } : {}),
      ...(f.who === "paid"
        ? { ledger: { some: { amount: { gt: 0 }, reason: { contains: "topup" } } } }
        : {}),
      ...(f.who === "never_paid"
        ? { ledger: { none: { amount: { gt: 0 }, reason: { contains: "topup" } } } }
        : {}),
      ...(f.who === "no_job" ? { galleryItems: { none: {} } } : {}),
      ...(createdBefore ? { createdAt: { lte: createdBefore } } : {}),
    },
    ...(quietFrom ? { lastSeenAt: { gte: quietFrom } } : {}),
  };
}

async function deliverBroadcastPayload(
  chatId: string | number,
  text: string,
  media: BroadcastMediaItem[],
  buttons: BroadcastButton[],
  token: string,
) {
  const markup = buttonsMarkup(buttons);

  // Never sendMediaGroup by HTTP URL — Telegram often fails with
  // WEBPAGE_CURL_FAILED on message #2. Upload local bytes (or URL fallback
  // inside tgDeliver*) one message at a time.
  if (media.length >= 1) {
    for (let i = 0; i < media.length; i++) {
      const m = media[i]!;
      const caption = i === 0 && text.trim() ? text : undefined;
      const attachMarkup = Boolean(markup) && media.length === 1 && i === 0;
      const extra = attachMarkup ? { reply_markup: markup } : {};
      if (m.type === "video") {
        await tgDeliverVideo({
          chatId,
          url: m.url,
          caption,
          extra,
          token,
        });
      } else {
        await tgDeliverPhoto({
          chatId,
          url: m.url,
          caption,
          extra,
          token,
        });
      }
    }
    if (markup && media.length >= 2) {
      await tgSendMessage(
        chatId,
        buttons.length ? "👇" : text || "·",
        { reply_markup: markup },
        token,
      );
    }
    return;
  }
  await tgSendMessage(chatId, text, markup ? { reply_markup: markup } : {}, token);
}

export type BroadcastEditableFields = {
  title?: string;
  bodyRu?: string;
  bodyEn?: string;
  mediaUrl?: string;
  mediaJson?: string;
  buttonsJson?: string;
  filterJson?: string;
  scheduledAt?: Date | null;
};

function assertEditable(status: string) {
  if (status !== "draft" && status !== "scheduled") {
    throw new Error("Можно править только черновик или запланированную рассылку");
  }
}

export async function updateBroadcast(
  id: string,
  fields: BroadcastEditableFields,
) {
  const row = await prisma.broadcast.findUnique({ where: { id } });
  if (!row) throw new Error("Рассылка не найдена");
  assertEditable(row.status);

  const data: Record<string, unknown> = {};
  if (fields.title !== undefined) data.title = fields.title.trim().slice(0, 200);
  if (fields.bodyRu !== undefined) data.bodyRu = fields.bodyRu;
  if (fields.bodyEn !== undefined) data.bodyEn = fields.bodyEn;
  if (fields.mediaUrl !== undefined) data.mediaUrl = fields.mediaUrl;
  if (fields.mediaJson !== undefined) data.mediaJson = fields.mediaJson;
  if (fields.buttonsJson !== undefined) data.buttonsJson = fields.buttonsJson;
  if (fields.filterJson !== undefined) data.filterJson = fields.filterJson;

  if (fields.scheduledAt !== undefined) {
    if (fields.scheduledAt === null) {
      data.scheduledAt = null;
      if (row.status === "scheduled") data.status = "draft";
    } else {
      if (fields.scheduledAt.getTime() <= Date.now() - 30_000) {
        throw new Error("Время отправки должно быть в будущем (МСК)");
      }
      data.scheduledAt = fields.scheduledAt;
      data.status = "scheduled";
    }
  }

  if (!Object.keys(data).length) {
    throw new Error("Нечего обновлять");
  }

  return prisma.broadcast.update({ where: { id }, data });
}

export async function scheduleBroadcast(id: string, scheduledAt: Date) {
  if (!(scheduledAt instanceof Date) || Number.isNaN(scheduledAt.getTime())) {
    throw new Error("Некорректная дата");
  }
  if (scheduledAt.getTime() <= Date.now() - 30_000) {
    throw new Error("Время отправки должно быть в будущем (МСК)");
  }
  const row = await prisma.broadcast.findUnique({ where: { id } });
  if (!row) throw new Error("Рассылка не найдена");
  assertEditable(row.status);
  await resolveBroadcastTargetBots(parseFilter(row.filterJson));
  return prisma.broadcast.update({
    where: { id },
    data: { status: "scheduled", scheduledAt },
  });
}

export async function unscheduleBroadcast(id: string) {
  const row = await prisma.broadcast.findUnique({ where: { id } });
  if (!row) throw new Error("Рассылка не найдена");
  if (row.status !== "scheduled" && row.status !== "draft") {
    throw new Error("Снять с плана можно только запланированную рассылку");
  }
  return prisma.broadcast.update({
    where: { id },
    data: { status: "draft", scheduledAt: null },
  });
}

export async function runBroadcast(
  id: string,
  _opts?: { skipCooldown?: boolean },
) {
  const row = await prisma.broadcast.findUnique({ where: { id } });
  if (!row) throw new Error("Рассылка не найдена");
  if (row.status === "sending") throw new Error("Рассылка уже отправляется");
  if (row.status === "sent") throw new Error("Рассылка уже отправлена");
  if (row.status !== "draft" && row.status !== "scheduled") {
    throw new Error(`Нельзя отправить со статусом ${row.status}`);
  }

  // Validate targets up front so UI gets a clear error before background fan-out.
  await resolveBroadcastTargetBots(parseFilter(row.filterJson));

  // Atomic claim — avoids double-send from UI + scheduler.
  const claimed = await prisma.broadcast.updateMany({
    where: { id, status: { in: ["draft", "scheduled"] } },
    data: {
      status: "sending",
      sentCount: 0,
      failCount: 0,
      sentByBotJson: "{}",
      scheduledAt: null,
    },
  });
  if (claimed.count !== 1) {
    throw new Error("Рассылка уже отправляется или недоступна");
  }

  // Heavy fan-out continues in background; caller already got "started".
  void processBroadcastSend(id).catch(async (e) => {
    console.error("[ops] broadcast send:", e);
    try {
      await prisma.broadcast.update({
        where: { id },
        data: { status: "draft" },
      });
    } catch {
      /* ignore */
    }
  });
}

async function processBroadcastSend(id: string) {
  const row = await prisma.broadcast.findUnique({ where: { id } });
  if (!row || row.status !== "sending") return;

  const f = parseFilter(row.filterJson);
  const media = parseMediaJson(row.mediaJson, row.mediaUrl);
  const buttons = parseButtonsJson(row.buttonsJson);
  const bots = await resolveBroadcastTargetBots(f);
  const byBot = emptyBotStats(bots);

  const accounts = await prisma.platformAccount.findMany({
    where: await buildWhere(f),
    include: { user: { select: { locale: true } } },
    take: 5000,
  });

  let tick = 0;
  for (const acc of accounts) {
    const locale = normalizeLocale(acc.user.locale);
    const bodyEn = row.bodyEn || "";
    const bodyRu = row.bodyRu || "";
    const text = locale === "en" && bodyEn.trim() ? bodyEn : bodyRu;
    if (!text.trim() && !media.length) continue;

    for (const bot of bots) {
      const key = `@${bot.username || bot.id}`;
      const bucket = byBot[key]!;
      try {
        await deliverBroadcastPayload(
          acc.platformUserId,
          text,
          media,
          buttons,
          bot.token,
        );
        bucket.sent += 1;
      } catch {
        bucket.fail += 1;
      }
      tick += 1;
      await new Promise((r) => setTimeout(r, 35));
      if (tick % 25 === 0) {
        const totals = totalsFromBotStats(byBot);
        await prisma.broadcast.update({
          where: { id },
          data: {
            sentCount: totals.sent,
            failCount: totals.fail,
            sentByBotJson: JSON.stringify(byBot),
          },
        });
      }
    }
  }

  const totals = totalsFromBotStats(byBot);
  await prisma.broadcast.update({
    where: { id },
    data: {
      status: "sent",
      sentCount: totals.sent,
      failCount: totals.fail,
      sentByBotJson: JSON.stringify(byBot),
      sentAt: new Date(),
    },
  });
  await saveOpsSettings({ lastBroadcastAt: new Date() });
}

export async function deleteBroadcast(id: string) {
  const row = await prisma.broadcast.findUnique({ where: { id } });
  if (!row) throw new Error("Рассылка не найдена");
  if (row.status === "sending") {
    throw new Error("Нельзя удалить рассылку, пока она отправляется");
  }
  await prisma.broadcast.delete({ where: { id } });
}

export async function sendTestBroadcast(opts: {
  actorUserId: string;
  bodyRu: string;
  bodyEn: string;
  mediaUrl?: string;
  mediaJson?: string;
  buttonsJson?: string;
  /** Explicit Telegram user id for preview (overrides actor's own TG). */
  testTgId?: string;
  /** Active bot instance ids; omit = all active. */
  botIds?: string[];
}): Promise<{
  results: Array<{ username: string; ok: boolean; error?: string }>;
}> {
  let chatId = (opts.testTgId || "").trim().replace(/\s+/g, "");
  if (chatId && !/^\d{5,15}$/.test(chatId)) {
    throw new Error("Telegram id — только цифры (user id, не @username)");
  }
  if (!chatId) {
    const acc = await prisma.platformAccount.findFirst({
      where: { userId: opts.actorUserId, platform: "telegram" },
    });
    if (!acc) {
      throw new Error(
        "Укажите Telegram id для теста или привяжите свой TG к ops-аккаунту",
      );
    }
    chatId = acc.platformUserId;
  }
  const user = await prisma.user.findUnique({ where: { id: opts.actorUserId } });
  const locale = normalizeLocale(user?.locale);
  const text =
    locale === "en" && (opts.bodyEn || "").trim()
      ? opts.bodyEn
      : opts.bodyRu || "";
  const media = parseMediaJson(opts.mediaJson || "[]", opts.mediaUrl);
  const buttons = parseButtonsJson(opts.buttonsJson || "[]");
  if (!text.trim() && !media.length) {
    throw new Error("Нужен текст RU или хотя бы одно медиа");
  }

  const bots = await resolveBroadcastTargetBots({
    botIds: opts.botIds,
  });
  const results: Array<{ username: string; ok: boolean; error?: string }> = [];
  for (const bot of bots) {
    try {
      await deliverBroadcastPayload(chatId, text, media, buttons, bot.token);
      results.push({ username: bot.username || bot.id, ok: true });
    } catch (e) {
      results.push({
        username: bot.username || bot.id,
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  if (!results.some((r) => r.ok)) {
    throw new Error(
      `Тест не дошёл ни в одного бота: ${results
        .map((r) => `@${r.username}: ${r.error || "fail"}`)
        .join("; ")}`,
    );
  }
  return { results };
}

/** Suggested button presets for the ops UI (bot sections first, then Mini App). */
export const BROADCAST_BUTTON_PRESETS: BroadcastButton[] = [
  ...BROADCAST_BOT_SECTION_OPTIONS.map(({ text, path }) => ({ text, path })),
  ...BROADCAST_MINIAPP_OPTIONS.map(({ text, path }) => ({ text, path })),
];
