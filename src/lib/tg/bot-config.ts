import { prisma } from "@/lib/db";
import { ensurePrimaryBotFromEnv } from "@/lib/tg/bot-registry";

const FALLBACK_BOT_URL =
  process.env.TELEGRAM_BOT_PUBLIC_URL || "https://t.me/peachbibot";

function usernameFromEnvFallback(): string {
  const fromName = (process.env.TELEGRAM_BOT_USERNAME || "")
    .trim()
    .replace(/^@/, "");
  if (fromName) return fromName;
  const fromUrl = (
    process.env.TELEGRAM_BOT_PUBLIC_URL || FALLBACK_BOT_URL
  ).match(/t\.me\/([A-Za-z0-9_]+)/i)?.[1];
  return fromUrl || "peachbibot";
}

/** Same primary as ops «Бот» — partner links / Mini App must use this. */
export async function getPrimaryBotUsername(): Promise<string> {
  const primary = await prisma.botInstance.findFirst({
    where: { status: "active", isPrimary: true },
    orderBy: { activatedAt: "desc" },
    select: { username: true },
  });
  const name = (primary?.username || "").replace(/^@/, "").trim();
  if (name) return name;
  const any = await prisma.botInstance.findFirst({
    where: { status: "active" },
    orderBy: { activatedAt: "desc" },
    select: { username: true },
  });
  const anyName = (any?.username || "").replace(/^@/, "").trim();
  if (anyName) return anyName;
  return usernameFromEnvFallback();
}

/** Active primary bot deep link (DB → env fallback). Dual bots stay active but don't steal /bot. */
export async function getActiveBotUrl(): Promise<string> {
  const username = await getPrimaryBotUsername();
  return `https://t.me/${username}`;
}

export async function ensureDefaultBotInstance(): Promise<void> {
  await ensurePrimaryBotFromEnv();
}
