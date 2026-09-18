/**
 * Staff Telegram bot for a forum-group with topics:
 * payments / signups / marketing digest / errors.
 *
 * Token + chat id come from env. Topic ids are created once and persisted
 * under data/ops-telegram.json (Railway volume) so restarts keep the same threads.
 */
import fs from "fs";
import path from "path";
import { prisma } from "@/lib/db";
import { dataRoot, ensureDataDirs } from "@/lib/paths";
import { tgApiWithToken, tgSendMessage } from "@/lib/tg/telegram-api";

export const OPS_TG_TOPICS = ["payments", "signups", "marketing", "errors"] as const;
export type OpsTgTopic = (typeof OPS_TG_TOPICS)[number];

const TOPIC_TITLES: Record<OpsTgTopic, string> = {
  payments: "Оплаты",
  signups: "Регистрации",
  marketing: "Маркетинг",
  errors: "Ошибки",
};

const STATE_FILE = () => path.join(dataRoot(), "ops-telegram.json");

export type OpsTelegramState = {
  chatId: string;
  isForum: boolean;
  topics: Partial<Record<OpsTgTopic, number>>;
  lastDigestKey?: string;
  lastDigestAt?: string;
  botUsername?: string;
  chatTitle?: string;
};

type ChatInfo = {
  id: number;
  title?: string;
  type?: string;
  is_forum?: boolean;
};

const errorThrottle = new Map<string, { at: number; skipped: number }>();
const ERROR_THROTTLE_MS = 60_000;

let sendChain: Promise<void> = Promise.resolve();

function envToken(): string {
  return (
    process.env.OPS_TG_BOT_TOKEN?.trim() ||
    process.env.TELEGRAM_BOT_TOKEN?.trim() ||
    ""
  );
}

function envChatId(): string {
  return (process.env.OPS_TG_CHAT_ID || "").trim();
}

function envTopicId(topic: OpsTgTopic): number | undefined {
  const key =
    topic === "payments"
      ? "OPS_TG_TOPIC_PAYMENTS"
      : topic === "signups"
        ? "OPS_TG_TOPIC_SIGNUPS"
        : topic === "marketing"
          ? "OPS_TG_TOPIC_MARKETING"
          : "OPS_TG_TOPIC_ERRORS";
  const n = Number(process.env[key] || 0);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export function opsTelegramConfigured(): boolean {
  return Boolean(envToken() && envChatId());
}

export function escHtml(s: string): string {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function readState(): OpsTelegramState | null {
  try {
    const raw = fs.readFileSync(STATE_FILE(), "utf8");
    const v = JSON.parse(raw) as OpsTelegramState;
    if (!v || typeof v !== "object") return null;
    return v;
  } catch {
    return null;
  }
}

function writeState(next: OpsTelegramState) {
  ensureDataDirs();
  fs.writeFileSync(STATE_FILE(), JSON.stringify(next, null, 2), "utf8");
}

export function loadOpsTelegramState(): OpsTelegramState | null {
  return readState();
}

export function saveOpsTelegramState(patch: Partial<OpsTelegramState>) {
  const chatId = patch.chatId || envChatId() || readState()?.chatId || "";
  const prev = readState();
  const next: OpsTelegramState = {
    chatId,
    isForum: patch.isForum ?? prev?.isForum ?? false,
    topics: { ...(prev?.topics || {}), ...(patch.topics || {}) },
    lastDigestKey: patch.lastDigestKey ?? prev?.lastDigestKey,
    lastDigestAt: patch.lastDigestAt ?? prev?.lastDigestAt,
    botUsername: patch.botUsername ?? prev?.botUsername,
    chatTitle: patch.chatTitle ?? prev?.chatTitle,
  };
  writeState(next);
  return next;
}

export async function probeOpsTelegram(): Promise<{
  configured: boolean;
  tokenSet: boolean;
  chatIdSet: boolean;
  usingProductBot: boolean;
  botUsername: string | null;
  chatTitle: string | null;
  isForum: boolean | null;
  topics: Partial<Record<OpsTgTopic, number>>;
  lastDigestKey: string;
  lastDigestAt: string;
  detail: string;
}> {
  const tokenSet = Boolean(envToken());
  const chatIdSet = Boolean(envChatId());
  const usingProductBot = !process.env.OPS_TG_BOT_TOKEN?.trim() && tokenSet;
  const state = readState();
  const topics: Partial<Record<OpsTgTopic, number>> = {
    ...(state?.topics || {}),
  };
  for (const t of OPS_TG_TOPICS) {
    const fromEnv = envTopicId(t);
    if (fromEnv) topics[t] = fromEnv;
  }

  if (!tokenSet) {
    return {
      configured: false,
      tokenSet,
      chatIdSet,
      usingProductBot,
      botUsername: null,
      chatTitle: null,
      isForum: null,
      topics,
      lastDigestKey: state?.lastDigestKey || "",
      lastDigestAt: state?.lastDigestAt || "",
      detail: "Нет OPS_TG_BOT_TOKEN (и нет TELEGRAM_BOT_TOKEN как запасного).",
    };
  }

  let botUsername: string | null = state?.botUsername || null;
  try {
    const me = await tgApiWithToken<{ username?: string }>(envToken(), "getMe");
    botUsername = me.username || null;
  } catch (e) {
    return {
      configured: false,
      tokenSet,
      chatIdSet,
      usingProductBot,
      botUsername,
      chatTitle: state?.chatTitle || null,
      isForum: state?.isForum ?? null,
      topics,
      lastDigestKey: state?.lastDigestKey || "",
      lastDigestAt: state?.lastDigestAt || "",
      detail: `getMe: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  if (!chatIdSet) {
    return {
      configured: false,
      tokenSet: true,
      chatIdSet: false,
      usingProductBot,
      botUsername,
      chatTitle: null,
      isForum: null,
      topics,
      lastDigestKey: state?.lastDigestKey || "",
      lastDigestAt: state?.lastDigestAt || "",
      detail: "Задайте OPS_TG_CHAT_ID (супергруппа с темами, id вида -100…).",
    };
  }

  try {
    const chat = await tgApiWithToken<ChatInfo>(envToken(), "getChat", {
      chat_id: envChatId(),
    });
    return {
      configured: true,
      tokenSet: true,
      chatIdSet: true,
      usingProductBot,
      botUsername,
      chatTitle: chat.title || null,
      isForum: Boolean(chat.is_forum),
      topics,
      lastDigestKey: state?.lastDigestKey || "",
      lastDigestAt: state?.lastDigestAt || "",
      detail: chat.is_forum
        ? "Чат-форум доступен. Ветки создадутся при bootstrap / первой отправке."
        : "Чат доступен, но это не форум — все сообщения пойдут в общий чат с префиксом темы.",
    };
  } catch (e) {
    return {
      configured: false,
      tokenSet: true,
      chatIdSet: true,
      usingProductBot,
      botUsername,
      chatTitle: state?.chatTitle || null,
      isForum: state?.isForum ?? null,
      topics,
      lastDigestKey: state?.lastDigestKey || "",
      lastDigestAt: state?.lastDigestAt || "",
      detail: `getChat: ${e instanceof Error ? e.message : String(e)}. Добавьте бота админом с правом «управление темами».`,
    };
  }
}

async function resolveTopics(forceCreate = false): Promise<OpsTelegramState> {
  const token = envToken();
  const chatId = envChatId();
  if (!token || !chatId) {
    throw new Error("OPS_TG_BOT_TOKEN / OPS_TG_CHAT_ID не заданы");
  }

  const chat = await tgApiWithToken<ChatInfo>(token, "getChat", {
    chat_id: chatId,
  });
  const me = await tgApiWithToken<{ username?: string }>(token, "getMe");
  const prev = readState();
  const topics: Partial<Record<OpsTgTopic, number>> = {
    ...(prev?.chatId === chatId ? prev.topics : {}),
  };
  for (const t of OPS_TG_TOPICS) {
    const fromEnv = envTopicId(t);
    if (fromEnv) topics[t] = fromEnv;
  }

  const isForum = Boolean(chat.is_forum);
  if (isForum) {
    for (const t of OPS_TG_TOPICS) {
      if (topics[t] && !forceCreate) continue;
      const created = await tgApiWithToken<{ message_thread_id: number }>(
        token,
        "createForumTopic",
        { chat_id: chatId, name: TOPIC_TITLES[t] },
      );
      topics[t] = created.message_thread_id;
    }
  }

  return saveOpsTelegramState({
    chatId,
    isForum,
    topics,
    botUsername: me.username,
    chatTitle: chat.title,
  });
}

export async function ensureOpsTelegramTopics(opts?: { force?: boolean }) {
  return resolveTopics(Boolean(opts?.force));
}

function enqueueSend(fn: () => Promise<void>) {
  sendChain = sendChain.then(fn, fn);
  return sendChain;
}

async function sendChunks(
  topic: OpsTgTopic,
  text: string,
  threadId: number | undefined,
) {
  const token = envToken();
  const chatId = envChatId();
  const chunks = splitTelegram(text);
  for (const chunk of chunks) {
    const extra: Record<string, unknown> = {
      disable_web_page_preview: true,
    };
    if (threadId) extra.message_thread_id = threadId;
    try {
      await tgSendMessage(chatId, chunk, extra, token);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (threadId && /thread not found|TOPIC_CLOSED|MESSAGE_THREAD/i.test(msg)) {
        const state = await resolveTopics(true);
        const retryThread = state.topics[topic];
        await tgSendMessage(
          chatId,
          chunk,
          {
            disable_web_page_preview: true,
            ...(retryThread ? { message_thread_id: retryThread } : {}),
          },
          token,
        );
      } else if (/retry after/i.test(msg)) {
        const sec = Number(msg.match(/retry after (\d+)/i)?.[1] || 2);
        await sleep(Math.min(15, sec) * 1000);
        await tgSendMessage(chatId, chunk, extra, token);
      } else {
        throw e;
      }
    }
    await sleep(80);
  }
}

export async function sendOpsTelegram(
  topic: OpsTgTopic,
  text: string,
): Promise<void> {
  if (!opsTelegramConfigured()) return;
  const body = text.trim();
  if (!body) return;

  let lastErr: unknown;
  await enqueueSend(async () => {
    try {
      let state = readState();
      if (!state?.topics[topic] && envChatId()) {
        try {
          state = await resolveTopics(false);
        } catch (e) {
          console.warn(
            "[ops-tg] topics:",
            e instanceof Error ? e.message : e,
          );
        }
      }
      const threadId = envTopicId(topic) || state?.topics[topic];
      const prefixed =
        threadId || state?.isForum
          ? body
          : `<b>${TOPIC_TITLES[topic]}</b>\n${body}`;
      await sendChunks(topic, prefixed, threadId);
    } catch (e) {
      lastErr = e;
      console.error(
        "[ops-tg] send failed:",
        topic,
        e instanceof Error ? e.message : e,
      );
    }
  });
  if (lastErr) throw lastErr;
}

export async function pingOpsTelegramTopics(): Promise<string> {
  const state = await ensureOpsTelegramTopics();
  const when = formatMsk(new Date());
  for (const t of OPS_TG_TOPICS) {
    await sendOpsTelegram(
      t,
      `✅ Ветка <b>${TOPIC_TITLES[t]}</b> подключена.\n${when} МСК`,
    );
  }
  const bits = OPS_TG_TOPICS.map(
    (t) => `${TOPIC_TITLES[t]}=${state.topics[t] || "общий чат"}`,
  );
  return `Ок. ${state.chatTitle || state.chatId}. ${bits.join(" · ")}`;
}

function splitTelegram(text: string, max = 3800): string[] {
  if (text.length <= max) return [text];
  const parts: string[] = [];
  let rest = text;
  while (rest.length > max) {
    let cut = rest.lastIndexOf("\n", max);
    if (cut < max * 0.5) cut = max;
    parts.push(rest.slice(0, cut));
    rest = rest.slice(cut).trimStart();
  }
  if (rest) parts.push(rest);
  return parts;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export function formatMsk(d: Date): string {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

const USER_SELECT = {
  id: true,
  name: true,
  email: true,
  source: true,
  locale: true,
  createdAt: true,
  trafficLink: { select: { code: true, label: true } },
  partnerAttribution: {
    select: {
      partner: {
        select: {
          code: true,
          user: { select: { name: true } },
        },
      },
      link: { select: { slug: true, label: true } },
    },
  },
  platformAccounts: {
    where: { platform: "telegram" },
    select: { platformUserId: true, username: true, firstName: true },
    take: 1,
  },
} as const;

export type OpsUserIdentity = {
  who: string;
  sourceLine: string;
  partnerLine: string;
  locale: string;
  tgId: string;
};

export function formatOpsSource(user: {
  trafficLink?: { code: string; label: string } | null;
  partnerAttribution?: {
    partner: { code: string; user: { name: string | null } };
    link: { slug: string; label: string } | null;
  } | null;
}): { sourceLine: string; partnerLine: string } {
  if (user.trafficLink) {
    const label = user.trafficLink.label
      ? ` (${user.trafficLink.label})`
      : "";
    return {
      sourceLine: `трафик / <code>${escHtml(user.trafficLink.code)}</code>${escHtml(label)}`,
      partnerLine: "нет",
    };
  }
  if (user.partnerAttribution?.partner) {
    const p = user.partnerAttribution.partner;
    const link = user.partnerAttribution.link;
    const who = p.user?.name ? ` · ${escHtml(p.user.name)}` : "";
    const linkBit = link
      ? ` · ссылка <code>${escHtml(link.slug)}</code>${link.label ? " " + escHtml(link.label) : ""}`
      : "";
    return {
      sourceLine: `партнёр / <code>${escHtml(p.code)}</code>${who}${linkBit}`,
      partnerLine: `да · <code>${escHtml(p.code)}</code>${who}${linkBit}`,
    };
  }
  return { sourceLine: "органика (без метки)", partnerLine: "нет" };
}

export function formatOpsWho(user: {
  id: string;
  name: string | null;
  email: string;
  source: string;
  platformAccounts: Array<{
    platformUserId: string;
    username: string | null;
    firstName: string | null;
  }>;
}): string {
  const acc = user.platformAccounts[0];
  const name = escHtml(user.name || acc?.firstName || "без имени");
  const uname = acc?.username ? `@${escHtml(acc.username)}` : "";
  const tg = acc?.platformUserId
    ? `tg <code>${escHtml(acc.platformUserId)}</code>`
    : "";
  const web =
    user.source === "web" && !user.email.endsWith("@peachbitch.local")
      ? `web ${escHtml(user.email)}`
      : "";
  return [name, uname, tg || web, `<code>${escHtml(user.id)}</code>`]
    .filter(Boolean)
    .join(" · ");
}

export async function loadOpsUserIdentity(
  userId: string,
): Promise<OpsUserIdentity | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: USER_SELECT,
  });
  if (!user) return null;
  const src = formatOpsSource(user);
  return {
    who: formatOpsWho(user),
    sourceLine: src.sourceLine,
    partnerLine: src.partnerLine,
    locale: user.locale || "ru",
    tgId: user.platformAccounts[0]?.platformUserId || "",
  };
}

const METHOD_RU: Record<string, string> = {
  sbp: "СБП",
  card: "карта",
  crypto: "крипта",
};

export async function notifyOpsPayment(opts: {
  userId: string;
  peaches: number;
  amountMinor: number;
  method: string;
  currency?: string;
}): Promise<void> {
  if (!opsTelegramConfigured()) return;
  try {
    const ident = await loadOpsUserIdentity(opts.userId);
    const rub = (opts.amountMinor / 100).toFixed(0);
    const method = METHOD_RU[opts.method] || opts.method || "—";
    const text = [
      `💳 <b>Оплата прошла</b>`,
      `Кто: ${ident?.who || `<code>${escHtml(opts.userId)}</code>`}`,
      `Сумма: <b>${opts.peaches} 🍑</b> = ${escHtml(rub)} ${escHtml(opts.currency || "₽")}`,
      `Способ: ${escHtml(method)} (бот / мини-апп)`,
      `Партнёр: ${ident?.partnerLine || "—"}`,
      `Источник: ${ident?.sourceLine || "—"}`,
      formatMsk(new Date()) + " МСК",
    ].join("\n");
    await sendOpsTelegram("payments", text);
  } catch (e) {
    console.error("[ops-tg] payment notify:", e);
  }
}

export async function notifyOpsSignup(opts: {
  userId: string;
  via: "telegram" | "web";
}): Promise<void> {
  if (!opsTelegramConfigured()) return;
  try {
    const ident = await loadOpsUserIdentity(opts.userId);
    const via = opts.via === "web" ? "сайт" : "Telegram (бот / мини-апп)";
    const text = [
      `🆕 <b>Новая регистрация</b>`,
      `Кто: ${ident?.who || `<code>${escHtml(opts.userId)}</code>`}`,
      `Канал: ${via}`,
      `Источник: ${ident?.sourceLine || "—"}`,
      `Партнёр: ${ident?.partnerLine || "нет"}`,
      `Язык: ${escHtml(ident?.locale || "ru")}`,
      formatMsk(new Date()) + " МСК",
    ].join("\n");
    await sendOpsTelegram("signups", text);
  } catch (e) {
    console.error("[ops-tg] signup notify:", e);
  }
}

const KIND_RU: Record<string, string> = {
  generation: "генерация",
  lora: "LoRA",
  bot: "бот",
  payment: "оплата",
  miniapp: "мини-апп",
  gpu: "GPU",
  other: "прочее",
};

export function notifyOpsErrorBg(opts: {
  kind: string;
  title: string;
  message: string;
  count: number;
  fingerprint: string;
  userId?: string | null;
  stage?: string;
  jobId?: string;
}): void {
  if (!opsTelegramConfigured()) return;
  const prev = errorThrottle.get(opts.fingerprint);
  const now = Date.now();
  if (prev && now - prev.at < ERROR_THROTTLE_MS && opts.count > 1) {
    prev.skipped += 1;
    return;
  }
  const skipped = prev?.skipped || 0;
  errorThrottle.set(opts.fingerprint, { at: now, skipped: 0 });

  void (async () => {
    let who = "";
    if (opts.userId) {
      const ident = await loadOpsUserIdentity(opts.userId).catch(() => null);
      who = ident?.who || `<code>${escHtml(opts.userId)}</code>`;
    }
    const extra =
      skipped > 0 ? `\nПовторы за минуту (схлопнуты): +${skipped}` : "";
    const text = [
      `⚠️ <b>Ошибка</b> · ${escHtml(KIND_RU[opts.kind] || opts.kind)}`,
      opts.stage ? `Этап: ${escHtml(opts.stage)}` : "",
      `Суть: ${escHtml(opts.title || opts.message).slice(0, 400)}`,
      `Текст: <code>${escHtml(opts.message).slice(0, 900)}</code>`,
      `Повторов всего: ${opts.count}`,
      who ? `Кто: ${who}` : "",
      opts.jobId ? `GpuJob: <code>${escHtml(opts.jobId)}</code>` : "",
      extra,
      formatMsk(new Date()) + " МСК",
    ]
      .filter(Boolean)
      .join("\n");
    await sendOpsTelegram("errors", text);
  })().catch((e) => console.error("[ops-tg] error notify:", e));
}
