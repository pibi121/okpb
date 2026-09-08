import { prisma } from "@/lib/db";
import { ensurePrimaryBotFromEnv } from "@/lib/tg/bot-registry";

const FALLBACK_BOT_URL =
  process.env.TELEGRAM_BOT_PUBLIC_URL || "https://t.me/peachbibot";

/** Active primary bot deep link (DB → env fallback). Dual bots stay active but don't steal /bot. */
export async function getActiveBotUrl(): Promise<string> {
  const primary = await prisma.botInstance.findFirst({
    where: { status: "active", isPrimary: true },
    orderBy: { activatedAt: "desc" },
  });
  if (primary?.username) {
    return `https://t.me/${primary.username.replace(/^@/, "")}`;
  }
  const any = await prisma.botInstance.findFirst({
    where: { status: "active" },
    orderBy: { activatedAt: "desc" },
  });
  if (any?.username) {
    return `https://t.me/${any.username.replace(/^@/, "")}`;
  }
  return FALLBACK_BOT_URL;
}

export async function ensureDefaultBotInstance(): Promise<void> {
  await ensurePrimaryBotFromEnv();
}
