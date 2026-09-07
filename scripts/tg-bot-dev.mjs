/**
 * PeachBitch Telegram bot — long-polling dev runner.
 * Usage: TELEGRAM_BOT_TOKEN=... npm run tg:bot
 */
import "dotenv/config";

const API = "https://api.telegram.org/bot";

const M = {
  ru: {
    welcome: `🍑 <b>PeachBitch</b>\n\nAI-фото и видео с <b>твоей моделью</b>.\nЗагрузи фото один раз — генерируй сколько угодно.\n\n🎁 1 бесплатное фото\n🎁 −20% на первое видео\n\nНажми <b>✅ Мне есть 18 лет</b> или <b>📋 Правила</b>.`,
    ageOk: "Отлично! Пришли 3–5 фото для модели или открой шаблоны:",
    rules: `<b>PeachBitch — правила</b>\n\n• 18+\n• Только свои фото / с согласия модели\n• Без deepfake реальных людей без согласия\n• Без незаконного контента\n\nНажимая «Мне есть 18 лет», ты соглашаешься.`,
    templates: "Лента шаблонов:",
    openFeed: "🎬 Открыть ленту",
    balance: "Баланс: {n} 🍑",
    topup: "Пакеты (🍑):\n• Try — 109\n• Hot — 329 (+10%)\n• Fire — 659 (+20%)\n\nОплата: crypto / СБП (скоро)",
    langSwitch: "🌐 Language: English",
    photoGot: "📸 Фото получено.",
    menuModel: "👤 Моя модель",
    menuTpl: "🎬 Шаблоны",
    menuBal: "💰 Баланс",
    menuPay: "💳 Пополнить",
    menuWorks: "📁 Мои работы",
    menuAff: "📊 Партнёрка",
    affStats: "Партнёрка: 50% с оборота.\nВыплата USDT от 30.\n<i>Статистика — в Mini App</i>",
  },
  en: {
    welcome: `🍑 <b>PeachBitch</b>\n\nAI photos & videos with <b>your model</b>.\nUpload once — generate forever.\n\n🎁 1 free photo\n🎁 −20% first video\n\nTap <b>✅ I am 18+</b> or <b>📋 Rules</b>.`,
    ageOk: "Great! Send 3–5 photos for your model or open templates:",
    rules: `<b>PeachBitch — rules</b>\n\n• 18+ only\n• Your photos or explicit consent\n• No non-consensual deepfakes\n• No illegal content\n\nBy continuing you agree.`,
    templates: "Template feed:",
    openFeed: "🎬 Open feed",
    balance: "Balance: {n} peaches",
    topup: "Packs (🍑):\n• Try — 109\n• Hot — 329 (+10%)\n• Fire — 659 (+20%)\n\nPay: crypto / SBP (soon)",
    langSwitch: "🌐 Язык: Русский",
    photoGot: "📸 Photo received.",
    menuModel: "👤 My model",
    menuTpl: "🎬 Templates",
    menuBal: "💰 Balance",
    menuPay: "💳 Top up",
    menuWorks: "📁 My creations",
    menuAff: "📊 Affiliate",
    affStats: "Affiliate: 50% rev share.\nPayout USDT from 30.\n<i>Stats in Mini App</i>",
  },
};

/** @type {Map<number, "ru"|"en">} */
const userLocale = new Map();

function L(chatId, key, vars = {}) {
  const loc = userLocale.get(chatId) || "ru";
  let s = M[loc][key] || key;
  for (const [k, v] of Object.entries(vars)) {
    s = s.replace(`{${k}}`, String(v));
  }
  return s;
}

function mainMenu(chatId) {
  return {
    reply_markup: {
      keyboard: [
        [{ text: L(chatId, "menuModel") }, { text: L(chatId, "menuTpl") }],
        [{ text: L(chatId, "menuBal") }, { text: L(chatId, "menuPay") }],
        [{ text: L(chatId, "menuWorks") }, { text: L(chatId, "menuAff") }],
        [{ text: L(chatId, "langSwitch") }],
      ],
      resize_keyboard: true,
    },
  };
}

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error("Set TELEGRAM_BOT_TOKEN in .env");
  process.exit(1);
}

const base = `${API}${token}`;

async function api(method, body) {
  const res = await fetch(`${base}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  if (!json.ok) throw new Error(json.description || method);
  return json.result;
}

async function sendMessage(chatId, text, extra = {}) {
  return api("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    ...extra,
  });
}

async function handleStart(chatId, fromId, payload) {
  userLocale.set(chatId, "ru");
  await sendMessage(chatId, L(chatId, "welcome"), {
    reply_markup: {
      keyboard: [
        [{ text: "✅ Мне есть 18 лет" }, { text: "✅ I am 18+" }],
        [{ text: "📋 Правила" }, { text: "📋 Rules" }],
      ],
      resize_keyboard: true,
      one_time_keyboard: true,
    },
  });
  if (payload) console.log(`[tg] start payload ${fromId}: ${payload}`);
}

async function handleMessage(msg) {
  const chatId = msg.chat.id;
  const text = msg.text?.trim() || "";

  if (text.startsWith("/start")) {
    await handleStart(chatId, msg.from?.id || chatId, text.split(/\s+/)[1]);
    return;
  }

  if (text === "✅ Мне есть 18 лет" || text === "✅ I am 18+") {
    if (text.includes("18+")) userLocale.set(chatId, "en");
    else userLocale.set(chatId, "ru");
    await sendMessage(chatId, L(chatId, "ageOk"), mainMenu(chatId));
    return;
  }

  if (text === "📋 Правила" || text === "📋 Rules") {
    if (text.includes("Rules")) userLocale.set(chatId, "en");
    await sendMessage(chatId, L(chatId, "rules"));
    return;
  }

  if (text === M.ru.langSwitch || text === M.en.langSwitch) {
    const next = userLocale.get(chatId) === "en" ? "ru" : "en";
    userLocale.set(chatId, next);
    await sendMessage(chatId, L(chatId, "welcome"), mainMenu(chatId));
    return;
  }

  if (text === L(chatId, "menuTpl") || text === "🎬 Шаблоны" || text === "🎬 Templates") {
    const webAppUrl =
      process.env.TELEGRAM_MINIAPP_URL || "http://localhost:3000/tg/templates";
    await sendMessage(chatId, L(chatId, "templates"), {
      reply_markup: {
        inline_keyboard: [[{ text: L(chatId, "openFeed"), web_app: { url: webAppUrl } }]],
      },
    });
    return;
  }

  if (text === L(chatId, "menuBal") || text === "💰 Баланс" || text === "💰 Balance") {
    await sendMessage(chatId, L(chatId, "balance", { n: 0 }));
    return;
  }

  if (text === L(chatId, "menuPay") || text === "💳 Пополнить" || text === "💳 Top up") {
    await sendMessage(chatId, L(chatId, "topup"));
    return;
  }

  if (text === L(chatId, "menuAff") || text === "📊 Партнёрка" || text === "📊 Affiliate") {
    await sendMessage(chatId, L(chatId, "affStats"));
    return;
  }

  if (msg.photo?.length) {
    await sendMessage(chatId, L(chatId, "photoGot"));
    return;
  }

  await sendMessage(chatId, "👇", mainMenu(chatId));
}

async function poll() {
  let offset = 0;
  console.log("[tg-bot] @peachbibot polling…");
  for (;;) {
    try {
      const updates = await api("getUpdates", {
        offset,
        timeout: 30,
        allowed_updates: ["message"],
      });
      for (const u of updates) {
        offset = u.update_id + 1;
        if (u.message) await handleMessage(u.message);
      }
    } catch (e) {
      console.error("[tg-bot]", e);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

poll();
