import { prisma } from "@/lib/db";
import {
  parseTelegramUser,
  validateTelegramInitData,
} from "@/lib/tg/auth";
import { findOrCreateTelegramUser } from "@/lib/tg/user";
import { getSessionUserId } from "@/lib/auth";

function botToken() {
  return process.env.TELEGRAM_BOT_TOKEN || "";
}

/** Cookie session or Telegram initData header (Mini App iframe-safe). */
export async function resolveTgApiUserId(req: Request): Promise<string | null> {
  const fromCookie = await getSessionUserId();
  if (fromCookie) return fromCookie;

  const initData =
    req.headers.get("x-tg-init-data")?.trim() ||
    req.headers.get("X-Tg-Init-Data")?.trim() ||
    "";
  if (!initData) return null;

  const token = botToken();
  if (!token) return null;

  const fields = validateTelegramInitData(initData, token);
  if (!fields) return null;

  const tgUser = parseTelegramUser(fields);
  if (!tgUser) return null;

  const user = await findOrCreateTelegramUser(tgUser);
  return user.id;
}

/** @deprecated use resolveTgApiUserId */
export async function resolveTgApiUser(req: Request) {
  const id = await resolveTgApiUserId(req);
  if (!id) return null;
  return prisma.user.findUnique({ where: { id } });
}
