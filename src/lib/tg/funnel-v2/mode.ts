/**
 * Funnel v2 mode: preview (codeword) or global live.
 */
import { prisma } from "@/lib/db";
import { getOpsSettings } from "@/lib/ops/settings";

export type FunnelV2User = {
  id: string;
  tgFunnelV2Preview?: boolean;
  tgFunnelV2PreviewBalance?: number;
  tgFunnelV2BlurTrialsUsed?: number;
  tgFunnelV2RulesOk?: boolean;
  ageConfirmed?: boolean;
  balancePeaches?: number;
  adminRole?: string;
};

export async function isFunnelV2Live(): Promise<boolean> {
  if (process.env.TG_FUNNEL_V2_LIVE === "1") return true;
  const s = await getOpsSettings();
  return Boolean((s as { tgFunnelV2Live?: boolean }).tgFunnelV2Live);
}

export async function userOnFunnelV2(user: FunnelV2User): Promise<boolean> {
  if (user.tgFunnelV2Preview) return true;
  return isFunnelV2Live();
}

export async function getFunnelBalance(user: FunnelV2User): Promise<number> {
  if (user.tgFunnelV2Preview) {
    return Math.max(0, Number(user.tgFunnelV2PreviewBalance || 0));
  }
  return Math.max(0, Number(user.balancePeaches || 0));
}

export async function creditFunnelBalance(
  userId: string,
  amount: number,
): Promise<number> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new Error("user not found");
  if (user.tgFunnelV2Preview) {
    const next = Math.max(0, user.tgFunnelV2PreviewBalance + amount);
    await prisma.user.update({
      where: { id: userId },
      data: {
        tgFunnelV2PreviewBalance: next,
        tgFunnelV2BlurTrialsUsed: amount > 0 ? 0 : user.tgFunnelV2BlurTrialsUsed,
      },
    });
    return next;
  }
  const { creditPeaches } = await import("@/lib/tg/wallet");
  await creditPeaches(userId, amount, "funnel_v2_topup_sim");
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { balancePeaches: true },
  });
  return u?.balancePeaches ?? 0;
}

export async function debitFunnelBalance(
  userId: string,
  amount: number,
): Promise<{ ok: boolean; balance: number }> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return { ok: false, balance: 0 };
  if (user.tgFunnelV2Preview) {
    if (user.tgFunnelV2PreviewBalance < amount) {
      return { ok: false, balance: user.tgFunnelV2PreviewBalance };
    }
    const next = user.tgFunnelV2PreviewBalance - amount;
    await prisma.user.update({
      where: { id: userId },
      data: { tgFunnelV2PreviewBalance: next },
    });
    return { ok: true, balance: next };
  }
  const { debitPeaches } = await import("@/lib/tg/wallet");
  const r = await debitPeaches(userId, amount, "funnel_v2_gen");
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { balancePeaches: true },
  });
  const balance = u?.balancePeaches ?? 0;
  if (!r.ok) return { ok: false, balance };
  return { ok: true, balance };
}

export function funnelV2RulesAccepted(user: FunnelV2User): boolean {
  if (user.tgFunnelV2Preview) return Boolean(user.tgFunnelV2RulesOk);
  return Boolean(user.ageConfirmed);
}

export async function enterFunnelV2Preview(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: {
      tgFunnelV2Preview: true,
      tgFunnelV2PreviewBalance: 0,
      tgFunnelV2BlurTrialsUsed: 0,
      tgFunnelV2RulesOk: false,
    },
  });
}

export async function setFunnelV2Live(live: boolean): Promise<void> {
  await prisma.opsSetting.upsert({
    where: { id: "main" },
    create: { id: "main", tgFunnelV2Live: live },
    update: { tgFunnelV2Live: live },
  });
  const { invalidateOpsSettings } = await import("@/lib/ops/settings");
  invalidateOpsSettings();
}

export function canGoLive(user: FunnelV2User): boolean {
  const role = (user.adminRole || "").trim();
  return role === "owner" || role === "developer";
}
