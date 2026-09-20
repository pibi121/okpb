import { prisma } from "@/lib/db";
import { TG_PROMO } from "@/lib/tg-pricing";

export function isSameUtcDay(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}

export async function recordMiniAppVisit(userId: string): Promise<void> {
  const now = new Date();
  await prisma.user.update({
    where: { id: userId },
    data: {
      tgLastMiniAppAt: now,
      tgLastActiveAt: now,
      tgIdle3dSent: false,
      tgIdle7dSent: false,
    },
  });
}

/** @deprecated Free daily studio photo removed — always false. */
export async function canUseStudioDailyFree(_userId: string): Promise<boolean> {
  return false;
}

/** @deprecated Free daily studio photo removed. */
export async function consumeStudioDailyFree(_userId: string): Promise<void> {
  /* no-op */
}

export async function startLoraBonusWindow(userId: string): Promise<Date> {
  const expires = new Date(
    Date.now() + TG_PROMO.loraBonusWindowMin * 60 * 1000,
  );
  await prisma.user.update({
    where: { id: userId },
    data: { tgLoraBonusExpiresAt: expires },
  });
  return expires;
}

export function loraBonusActive(expiresAt: Date | null | undefined): boolean {
  if (!expiresAt) return false;
  return expiresAt.getTime() > Date.now();
}

/** @deprecated LoRA welcome free photos removed. */
export async function grantLoraWelcomePhotos(_userId: string): Promise<void> {
  /* no-op */
}

/** @deprecated LoRA welcome free photos removed. */
export async function consumeLoraWelcomePhoto(
  _userId: string,
): Promise<{ used: boolean; left: number }> {
  return { used: false, left: 0 };
}

export async function scheduleWelcomePush(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: {
      tgWelcomePushSent: true,
      tgWelcomePushDueAt: null,
    },
  });
}

export async function maybeSendWelcomePush(
  _chatId: number,
  userId: string,
  _locale: "ru" | "en",
  _send?: (body: string, extra?: Record<string, unknown>) => Promise<unknown>,
): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || user.tgWelcomePushSent) return;

  await prisma.user.update({
    where: { id: userId },
    data: { tgWelcomePushSent: true },
  });
}
