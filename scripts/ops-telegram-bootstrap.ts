/**
 * Create forum topics + send a test ping to the ops Telegram group.
 *
 *   cd peachbitch && npx tsx scripts/ops-telegram-bootstrap.ts
 *
 * Needs OPS_TG_BOT_TOKEN (or TELEGRAM_BOT_TOKEN) and OPS_TG_CHAT_ID.
 * If chat id is missing, waits ~45s for the bot to be added to a group
 * and prints the id to put in env.
 */
import "dotenv/config";
import { tgApiWithToken } from "../src/lib/tg/telegram-api";
import {
  ensureOpsTelegramTopics,
  pingOpsTelegramTopics,
} from "../src/lib/ops/ops-telegram";

type Update = {
  update_id: number;
  message?: { chat?: { id: number; title?: string; type?: string } };
  my_chat_member?: { chat?: { id: number; title?: string; type?: string } };
};

async function discoverChatId(token: string): Promise<string | null> {
  console.log(
    "[ops-tg] Нет OPS_TG_CHAT_ID. Добавьте бота админом в супергруппу с темами — жду 45 сек…",
  );
  const deadline = Date.now() + 45_000;
  let offset = 0;
  while (Date.now() < deadline) {
    const updates = await tgApiWithToken<Update[]>(token, "getUpdates", {
      offset,
      timeout: 10,
      allowed_updates: ["message", "my_chat_member"],
    });
    for (const u of updates) {
      offset = u.update_id + 1;
      const chat = u.my_chat_member?.chat || u.message?.chat;
      if (chat && (chat.type === "supergroup" || chat.type === "group")) {
        return String(chat.id);
      }
    }
  }
  return null;
}

async function main() {
  const token =
    process.env.OPS_TG_BOT_TOKEN?.trim() ||
    process.env.TELEGRAM_BOT_TOKEN?.trim() ||
    "";
  if (!token) {
    console.error("Задайте OPS_TG_BOT_TOKEN (или TELEGRAM_BOT_TOKEN).");
    process.exit(1);
  }

  let chatId = (process.env.OPS_TG_CHAT_ID || "").trim();
  if (!chatId) {
    const found = await discoverChatId(token);
    if (!found) {
      console.error(
        "Чат не найден. Создайте супергруппу, включите Темы, добавьте бота админом (сообщения + управление темами) и задайте OPS_TG_CHAT_ID.",
      );
      process.exit(1);
    }
    chatId = found;
    process.env.OPS_TG_CHAT_ID = chatId;
    console.log(`[ops-tg] Нашёл чат ${chatId}. Пропишите OPS_TG_CHAT_ID=${chatId}`);
  }

  const state = await ensureOpsTelegramTopics();
  console.log("[ops-tg] topics", state.topics, "forum=", state.isForum);
  const msg = await pingOpsTelegramTopics();
  console.log("[ops-tg]", msg);
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
