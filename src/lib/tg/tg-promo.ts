import { prisma } from "@/lib/db";
import { TG_PROMO } from "@/lib/tg-pricing";

const DAY_MS = 24 * 60 * 60 * 1000;

export function isSameUtcDay(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}

/** Mini App visit: grant daily studio free if 24h passed since last use. */
export async function recordMiniAppVisit(userId: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return;

  const now = new Date();
  const lastUse = user.tgStudioDailyUsedAt;
  const eligible =
    !lastUse || now.getTime() - lastUse.getTime() >= DAY_MS;

  await prisma.user.update({
    where: { id: userId },
    data: {
      tgLastMiniAppAt: now,
      tgLastActiveAt: now,
      tgIdle3dSent: false,
      tgIdle7dSent: false,
      ...(eligible ? { tgStudioFreeReady: true } : {}),
    },
  });
}

export async function canUseStudioDailyFree(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user?.tgStudioFreeReady) return false;
  if (!user.tgLastMiniAppAt) return false;

  const now = new Date();
  const lastUse = user.tgStudioDailyUsedAt;
  if (lastUse && now.getTime() - lastUse.getTime() < DAY_MS) {
    return false;
  }
  return true;
}

export async function consumeStudioDailyFree(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: {
      tgStudioDailyUsedAt: new Date(),
      tgStudioFreeReady: false,
    },
  });
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

export async function grantLoraWelcomePhotos(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { tgLoraWelcomePhotosLeft: TG_PROMO.loraWelcomePhotos },
  });
}

export async function consumeLoraWelcomePhoto(
  userId: string,
): Promise<{ used: boolean; left: number }> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  const left = user?.tgLoraWelcomePhotosLeft ?? 0;
  if (left <= 0) return { used: false, left: 0 };
  const next = left - 1;
  await prisma.user.update({
    where: { id: userId },
    data: { tgLoraWelcomePhotosLeft: next },
  });
  return { used: true, left: next };
}

export async function scheduleWelcomePush(userId: string): Promise<void> {
  const due = new Date(Date.now() + 30_000);
  await prisma.user.update({
    where: { id: userId },
    data: {
      tgWelcomePushSent: false,
      tgWelcomePushDueAt: due,
    },
  });
}

export async function maybeSendWelcomePush(
  chatId: number,
  userId: string,
  locale: "ru" | "en",
  send: (body: string, extra?: Record<string, unknown>) => Promise<unknown>,
): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || user.tgWelcomePushSent || !user.tgWelcomePushDueAt) return;
  if (user.tgWelcomePushDueAt.getTime() > Date.now()) return;

  const { t } = await import("@/lib/tg/i18n");
  const { castsMiniAppUrl } = await import("@/lib/tg/studio-cast");
  const { tgLoraTrainMiniAppUrl } = await import("@/lib/tg/miniapp-url");

  await send(t("welcome_free_push", locale), {
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: t("onboard_pick_studio_btn", locale),
            web_app: { url: castsMiniAppUrl() },
          },
        ],
        [
          {
            text: t("onboard_create_char_btn", locale),
            web_app: { url: tgLoraTrainMiniAppUrl() },
          },
        ],
      ],
    },
  });

  await prisma.user.update({
    where: { id: userId },
    data: { tgWelcomePushSent: true },
  });
}
