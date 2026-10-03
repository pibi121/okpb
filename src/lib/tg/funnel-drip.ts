/**
 * TG background pollers for Funnel v2: rules nudges + blur nudges.
 * Legacy marketing drips / idle winbacks / auto-rules removed.
 */
import { prisma } from "@/lib/db";

function isDeadTelegramChat(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /bot was blocked|chat not found|user is deactivated|Forbidden: bot/i.test(
    msg,
  );
}

/** Re-send rules+agree button at 10m / 3h / 24h for users who never confirmed. */
export async function pollRulesNudges(limit = 40): Promise<void> {
  const { maybeSendRulesNudges } = await import("@/lib/tg/onboarding-flow");
  const due10 = new Date(Date.now() - 10 * 60_000);
  const users = await prisma.user.findMany({
    where: {
      source: "telegram",
      OR: [
        {
          ageConfirmed: false,
          OR: [
            {
              tgRulesShownAt: { not: null, lte: due10 },
              tgRulesNudge10mSent: false,
            },
            {
              tgRulesShownAt: {
                not: null,
                lte: new Date(Date.now() - 3 * 60 * 60_000),
              },
              tgRulesNudge3hSent: false,
            },
            {
              tgRulesShownAt: {
                not: null,
                lte: new Date(Date.now() - 24 * 60 * 60_000),
              },
              tgRulesNudge24hSent: false,
            },
            {
              tgRulesShownAt: null,
              createdAt: { lte: due10 },
            },
          ],
        },
        {
          tgFunnelV2Preview: true,
          tgFunnelV2RulesOk: false,
          OR: [
            {
              tgRulesShownAt: { not: null, lte: due10 },
              tgRulesNudge10mSent: false,
            },
            {
              tgRulesShownAt: {
                not: null,
                lte: new Date(Date.now() - 3 * 60 * 60_000),
              },
              tgRulesNudge3hSent: false,
            },
            {
              tgRulesShownAt: {
                not: null,
                lte: new Date(Date.now() - 24 * 60 * 60_000),
              },
              tgRulesNudge24hSent: false,
            },
          ],
        },
      ],
    },
    select: { id: true },
    take: limit,
    orderBy: { createdAt: "asc" },
  });

  for (const u of users) {
    const acc = await prisma.platformAccount.findFirst({
      where: { userId: u.id, platform: "telegram" },
      select: { platformUserId: true },
    });
    if (!acc) continue;
    const chatId = Number(acc.platformUserId);
    if (!Number.isFinite(chatId)) continue;
    try {
      await maybeSendRulesNudges(chatId, u.id);
    } catch (e) {
      if (isDeadTelegramChat(e)) {
        await prisma.user.update({
          where: { id: u.id },
          data: {
            tgRulesNudge10mSent: true,
            tgRulesNudge3hSent: true,
            tgRulesNudge24hSent: true,
          },
        });
        continue;
      }
      console.error("[tg-rules-nudge]", u.id, e);
    }
  }
}

let funnelPollBusy = false;
let lastFunnelPollAt = 0;

/** Background: rules nudges + Funnel v2 blur nudges. */
export async function pollTgFunnelDrips(limit = 25): Promise<void> {
  if (funnelPollBusy) return;
  if (Date.now() - lastFunnelPollAt < 15_000) return;
  funnelPollBusy = true;
  lastFunnelPollAt = Date.now();
  try {
    await pollRulesNudges(Math.min(40, limit));
    const { pollFunnelV2FaststartNudges } = await import(
      "@/lib/tg/funnel-v2/faststart"
    );
    await pollFunnelV2FaststartNudges(Math.min(40, limit));
  } finally {
    funnelPollBusy = false;
  }
}
