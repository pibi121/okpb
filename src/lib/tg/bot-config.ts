import { prisma } from "@/lib/db";

const FALLBACK_BOT_URL =
  process.env.TELEGRAM_BOT_PUBLIC_URL || "https://t.me/peachbibot";

/** Active bot deep link (DB → env fallback). */
export async function getActiveBotUrl(): Promise<string> {
  const active = await prisma.botInstance.findFirst({
    where: { status: "active" },
    orderBy: { activatedAt: "desc" },
  });
  if (active?.username) {
    const u = active.username.replace(/^@/, "");
    return `https://t.me/${u}`;
  }
  return FALLBACK_BOT_URL;
}

export async function ensureDefaultBotInstance(): Promise<void> {
  const count = await prisma.botInstance.count();
  if (count > 0) return;
  const url = FALLBACK_BOT_URL;
  const match = url.match(/t\.me\/([A-Za-z0-9_]+)/);
  const username = match?.[1] || "peachbibot";
  await prisma.botInstance.create({
    data: { username, status: "active" },
  });
}
