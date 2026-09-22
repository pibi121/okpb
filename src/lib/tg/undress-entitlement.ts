/**
 * Undress free credits + daily feed loot.
 * Welcome: 1 free for everyone once (existing + new).
 * Loot: +1/day after ~25–30s feed watch; never stack above 1 unused credit.
 */
import { prisma } from "@/lib/db";

const MSK = "Europe/Moscow";

export function moscowDayKey(d = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: MSK,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** Ensure welcome free undress is granted once. Returns current free credits. */
export async function ensureUndressWelcome(userId: string): Promise<number> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      tgUndressWelcomeGranted: true,
      tgUndressFreeCredits: true,
    },
  });
  if (!user) return 0;
  if (user.tgUndressWelcomeGranted) {
    return Math.max(0, user.tgUndressFreeCredits);
  }
  const updated = await prisma.user.update({
    where: { id: userId },
    data: {
      tgUndressWelcomeGranted: true,
      tgUndressFreeCredits: Math.max(1, user.tgUndressFreeCredits),
    },
    select: { tgUndressFreeCredits: true },
  });
  return Math.max(0, updated.tgUndressFreeCredits);
}

export async function getUndressFreeCredits(userId: string): Promise<number> {
  return ensureUndressWelcome(userId);
}

export async function undressStatus(userId: string): Promise<{
  freeCredits: number;
  canLootToday: boolean;
  lootDay: string;
}> {
  const freeCredits = await ensureUndressWelcome(userId);
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { tgUndressLootDay: true },
  });
  const today = moscowDayKey();
  const lootDay = user?.tgUndressLootDay || "";
  return {
    freeCredits,
    canLootToday: lootDay !== today && freeCredits < 1,
    lootDay,
  };
}

/**
 * Claim daily feed loot. Requires watchSeconds >= 25.
 * Only if freeCredits === 0 and not claimed today.
 */
export async function claimUndressLoot(
  userId: string,
  watchSeconds: number,
): Promise<
  | { ok: true; freeCredits: number }
  | { ok: false; error: string; freeCredits: number }
> {
  if (!(watchSeconds >= 25)) {
    const freeCredits = await getUndressFreeCredits(userId);
    return { ok: false, error: "watch_more", freeCredits };
  }
  const status = await undressStatus(userId);
  if (status.freeCredits >= 1) {
    return { ok: false, error: "already_have_free", freeCredits: status.freeCredits };
  }
  const today = moscowDayKey();
  if (status.lootDay === today) {
    return { ok: false, error: "already_looted_today", freeCredits: status.freeCredits };
  }
  const updated = await prisma.user.update({
    where: { id: userId },
    data: {
      tgUndressFreeCredits: 1,
      tgUndressLootDay: today,
    },
    select: { tgUndressFreeCredits: true },
  });
  return { ok: true, freeCredits: updated.tgUndressFreeCredits };
}

/** Consume one free credit. Returns false if none. */
export async function consumeUndressFree(
  userId: string,
): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { tgUndressFreeCredits: true },
  });
  if (!user || user.tgUndressFreeCredits < 1) return false;
  const res = await prisma.user.updateMany({
    where: { id: userId, tgUndressFreeCredits: { gte: 1 } },
    data: { tgUndressFreeCredits: { decrement: 1 } },
  });
  return res.count > 0;
}

/** Restore one free credit after QC approve (cap 1). */
export async function restoreUndressFree(userId: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { tgUndressFreeCredits: true },
  });
  if (!user) return;
  if (user.tgUndressFreeCredits >= 1) return;
  await prisma.user.update({
    where: { id: userId },
    data: { tgUndressFreeCredits: 1 },
  });
}
