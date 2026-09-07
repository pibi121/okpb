import { prisma } from "@/lib/db";
import { creditPartnerCommission } from "@/lib/tg/partner-program";

export async function getBalancePeaches(userId: string): Promise<number> {
  const u = await prisma.user.findUnique({ where: { id: userId } });
  return u?.balancePeaches ?? 0;
}

export async function creditPeaches(
  userId: string,
  amount: number,
  reason: string,
  meta?: Record<string, unknown>,
) {
  if (amount <= 0) return;
  await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: { balancePeaches: { increment: amount } },
    }),
    prisma.ledgerEntry.create({
      data: {
        userId,
        amount,
        reason,
        metaJson: meta ? JSON.stringify(meta) : null,
      },
    }),
  ]);

  if (/topup|payment|начисл/i.test(reason)) {
    void creditPartnerCommission({
      referredUserId: userId,
      grossPeaches: amount,
      kind: "topup",
    }).catch((e) => console.error("[partner] commission:", e));
    void import("@/lib/ops/traffic")
      .then(({ recordTrafficPurchase }) =>
        recordTrafficPurchase(userId, amount),
      )
      .catch(() => undefined);
  }
}

export async function debitPeaches(
  userId: string,
  amount: number,
  reason: string,
  meta?: Record<string, unknown>,
): Promise<{ ok: true } | { ok: false; balance: number }> {
  if (amount <= 0) return { ok: true };

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || user.balancePeaches < amount) {
    return { ok: false, balance: user?.balancePeaches ?? 0 };
  }

  await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: { balancePeaches: { decrement: amount } },
    }),
    prisma.ledgerEntry.create({
      data: {
        userId,
        amount: -amount,
        reason,
        metaJson: meta ? JSON.stringify(meta) : null,
      },
    }),
  ]);

  return { ok: true };
}
