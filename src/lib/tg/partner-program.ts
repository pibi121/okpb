/**
 * TG partner program — referrals, commissions, withdrawals.
 */
import { prisma } from "@/lib/db";
import { randomBytes } from "crypto";
import { getPrimaryBotUsername } from "@/lib/tg/bot-config";

const LINK_SEP = "__";

/**
 * TEMP demo overlay for partner Mini App / bot «Заработать».
 * Display-only — does not write to DB or allow real withdrawals of fake balance.
 * Remove when real stats are ready.
 */
type DemoPartnerLink = {
  /** Match PartnerLink.slug */
  slug: string;
  clicks: number;
  signups: number;
  purchases: number;
  purchaseGrossPeaches: number;
  commissionPeaches: number;
};

type DemoPartnerRow = {
  referrals: number;
  purchases: number;
  purchaseGrossPeaches: number;
  commissionPeaches: number;
  balancePeaches: number;
  totalEarnedPeaches: number;
  commissionPct: number;
  links?: DemoPartnerLink[];
};

const DEMO_PARTNER_BY_TG: Record<string, DemoPartnerRow> = {
  // 2026-10-18 hold-withdraw test: real DB balance 10k / frozen 7k — keep UI aligned
  "8762393340": {
    referrals: 411,
    purchases: 63,
    purchaseGrossPeaches: 45394,
    commissionPeaches: 10000,
    balancePeaches: 10000,
    totalEarnedPeaches: 10000,
    commissionPct: 50,
  },
  // 2026-09-25…10-13 bumps; 2026-10-22: +9d traffic +30% / CR-10%, check ~657, 90% withdrawn
  "8612204954": {
    referrals: 3897,
    purchases: 785,
    purchaseGrossPeaches: 515860,
    commissionPeaches: 257930,
    // ~10% of earned left on balance (90% «выведено»)
    balancePeaches: 25793,
    totalEarnedPeaches: 257930,
    commissionPct: 50,
    links: [
      // Тр1 weak
      {
        slug: "1",
        clicks: 125,
        signups: 65,
        purchases: 9,
        purchaseGrossPeaches: 5904,
        commissionPeaches: 2952,
      },
      // Тр2 strongest
      {
        slug: "2",
        clicks: 373,
        signups: 202,
        purchases: 40,
        purchaseGrossPeaches: 26320,
        commissionPeaches: 13160,
      },
      // Тр3 mid
      {
        slug: "3",
        clicks: 206,
        signups: 110,
        purchases: 20,
        purchaseGrossPeaches: 13160,
        commissionPeaches: 6580,
      },
    ],
  },
  /**
   * produsai — main link stays real (no slug overlay).
   * Extra links: demo counters from @dmitriy_9118 avg rates
   * (click→start ≈100%, start→pay ≈15.6%, avg check ≈354₽, 50% share).
   * Totals = real main + demo links.
   */
  "6919297903": {
    referrals: 421,
    purchases: 52,
    purchaseGrossPeaches: 20148,
    commissionPeaches: 10074,
    balancePeaches: 10074,
    totalEarnedPeaches: 10074,
    commissionPct: 50,
    links: [
      {
        slug: "threads_1",
        clicks: 70,
        signups: 70,
        purchases: 11,
        purchaseGrossPeaches: 3894,
        commissionPeaches: 1947,
      },
      {
        slug: "yutsh",
        clicks: 147,
        signups: 147,
        purchases: 23,
        purchaseGrossPeaches: 8142,
        commissionPeaches: 4071,
      },
      {
        slug: "nk",
        clicks: 32,
        signups: 32,
        purchases: 5,
        purchaseGrossPeaches: 1770,
        commissionPeaches: 885,
      },
      {
        slug: "posev_1",
        clicks: 0,
        signups: 0,
        purchases: 0,
        purchaseGrossPeaches: 0,
        commissionPeaches: 0,
      },
    ],
  },
}

export function parsePartnerRefPayload(payload: string | undefined): {
  code?: string;
  linkSlug?: string;
} {
  if (!payload?.startsWith("ref_")) return {};
  const rest = payload.slice(4).trim();
  if (!rest) return {};
  const [code, linkSlug] = rest.split(LINK_SEP);
  return { code: code || undefined, linkSlug: linkSlug || undefined };
}

function randomCode(len = 8): string {
  return randomBytes(Math.ceil(len / 2))
    .toString("hex")
    .slice(0, len)
    .toLowerCase();
}

/** Validate partner commission % for ops + charging. Returns null if invalid. */
export function clampPartnerCommissionPct(raw: unknown): number | null {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return null;
  const pct = Math.round(n);
  if (pct < 0 || pct > 100) return null;
  return pct;
}

export async function ensurePartnerProfile(userId: string) {
  const existing = await prisma.partnerProfile.findUnique({ where: { userId } });
  if (existing) return existing;

  for (let i = 0; i < 8; i++) {
    const code = randomCode(8);
    try {
      return await prisma.partnerProfile.create({
        data: { userId, code },
      });
    } catch {
      /* collision */
    }
  }
  throw new Error("Не удалось создать партнёрский профиль");
}

export async function recordPartnerClick(code: string, linkSlug?: string) {
  const partner = await prisma.partnerProfile.findFirst({
    where: { code, status: "active" },
  });
  if (!partner) return null;

  if (linkSlug) {
    const link = await prisma.partnerLink.findFirst({
      where: { partnerId: partner.id, slug: linkSlug },
    });
    if (link) {
      await prisma.partnerLink.update({
        where: { id: link.id },
        data: { clicks: { increment: 1 } },
      });
      return { partnerId: partner.id, linkId: link.id };
    }
  }

  const main = await prisma.partnerLink.findFirst({
    where: { partnerId: partner.id, slug: "main" },
  });
  if (main) {
    await prisma.partnerLink.update({
      where: { id: main.id },
      data: { clicks: { increment: 1 } },
    });
    return { partnerId: partner.id, linkId: main.id };
  }
  return { partnerId: partner.id, linkId: undefined };
}

export async function attributeUserToPartner(opts: {
  userId: string;
  code: string;
  linkSlug?: string;
}) {
  const existing = await prisma.partnerAttribution.findUnique({
    where: { userId: opts.userId },
  });
  if (existing) return existing;

  const partner = await prisma.partnerProfile.findFirst({
    where: { code: opts.code, status: "active" },
  });
  if (!partner || partner.userId === opts.userId) return null;

  let linkId: string | undefined;
  if (opts.linkSlug) {
    const link = await prisma.partnerLink.findFirst({
      where: { partnerId: partner.id, slug: opts.linkSlug },
    });
    linkId = link?.id;
    if (link) {
      await prisma.partnerLink.update({
        where: { id: link.id },
        data: { signups: { increment: 1 } },
      });
    }
  } else {
    const main = await prisma.partnerLink.findFirst({
      where: { partnerId: partner.id, slug: "main" },
    });
    if (main) {
      linkId = main.id;
      await prisma.partnerLink.update({
        where: { id: main.id },
        data: { signups: { increment: 1 } },
      });
    }
  }

  return prisma.partnerAttribution.create({
    data: {
      userId: opts.userId,
      partnerId: partner.id,
      linkId,
    },
  });
}

export async function creditPartnerCommission(opts: {
  referredUserId: string;
  grossPeaches: number;
  kind?: string;
}): Promise<{ id: string; amount: number } | null> {
  if (opts.grossPeaches <= 0) return null;
  const attr = await prisma.partnerAttribution.findUnique({
    where: { userId: opts.referredUserId },
    include: { partner: true },
  });
  if (!attr || attr.partner.status !== "active") return null;

  const pct =
    clampPartnerCommissionPct(attr.partner.commissionPct) ??
    50;
  const amount = Math.floor((opts.grossPeaches * pct) / 100);
  if (amount <= 0) return null;

  const created = await prisma.$transaction(async (tx) => {
    await tx.partnerProfile.update({
      where: { id: attr.partnerId },
      data: {
        balancePeaches: { increment: amount },
        totalEarnedPeaches: { increment: amount },
      },
    });
    const row = await tx.partnerCommission.create({
      data: {
        partnerId: attr.partnerId,
        referredUserId: opts.referredUserId,
        linkId: attr.linkId,
        grossPeaches: opts.grossPeaches,
        amountPeaches: amount,
        kind: opts.kind || "topup",
      },
    });
    if (attr.linkId) {
      await tx.partnerLink.update({
        where: { id: attr.linkId },
        data: {
          purchases: { increment: 1 },
          purchaseGrossPeaches: { increment: opts.grossPeaches },
          commissionPeaches: { increment: amount },
        },
      });
    }
    return row;
  });

  // Don't spam on historical backfill; live top-ups use kind "topup".
  if ((opts.kind || "topup") === "topup") {
    void import("@/lib/tg/tg-notify")
      .then(({ notifyPartnerCommission }) =>
        notifyPartnerCommission({
          partnerUserId: attr.partner.userId,
          amountPeaches: amount,
        }),
      )
      .catch((e) => console.error("[partner] notify commission:", e));
  }

  return { id: created.id, amount };
}

/**
 * Reverse a topup commission after StreamPay (etc.) refund.
 * Partner balance may go negative if they already withdrew.
 */
export async function clawbackPartnerCommission(opts: {
  referredUserId: string;
  grossPeaches: number;
  kind?: string;
}): Promise<{ amount: number } | null> {
  if (opts.grossPeaches <= 0) return null;
  const kind = opts.kind || "topup";

  const commission = await prisma.partnerCommission.findFirst({
    where: {
      referredUserId: opts.referredUserId,
      kind,
      grossPeaches: opts.grossPeaches,
      amountPeaches: { gt: 0 },
    },
    orderBy: { createdAt: "desc" },
  });
  if (!commission) return null;

  // Already reversed for this commission row?
  const already = await prisma.partnerCommission.findFirst({
    where: {
      partnerId: commission.partnerId,
      referredUserId: opts.referredUserId,
      kind: `${kind}_refund`,
      grossPeaches: -opts.grossPeaches,
      amountPeaches: -commission.amountPeaches,
      createdAt: { gte: commission.createdAt },
    },
  });
  if (already) return { amount: 0 };

  const amount = commission.amountPeaches;

  await prisma.$transaction(async (tx) => {
    await tx.partnerProfile.update({
      where: { id: commission.partnerId },
      data: {
        balancePeaches: { decrement: amount },
        totalEarnedPeaches: { decrement: amount },
      },
    });
    await tx.partnerCommission.create({
      data: {
        partnerId: commission.partnerId,
        referredUserId: opts.referredUserId,
        linkId: commission.linkId,
        // Negative so partner dashboard _sum(gross/amount) stays correct.
        grossPeaches: -opts.grossPeaches,
        amountPeaches: -amount,
        kind: `${kind}_refund`,
      },
    });
    if (commission.linkId) {
      const link = await tx.partnerLink.findUnique({
        where: { id: commission.linkId },
      });
      if (link) {
        await tx.partnerLink.update({
          where: { id: commission.linkId },
          data: {
            purchases: Math.max(0, link.purchases - 1),
            purchaseGrossPeaches: Math.max(
              0,
              link.purchaseGrossPeaches - opts.grossPeaches,
            ),
            commissionPeaches: Math.max(0, link.commissionPeaches - amount),
          },
        });
      }
    }
  });

  console.info("[partner] commission clawback", {
    referredUserId: opts.referredUserId,
    amount,
    grossPeaches: opts.grossPeaches,
  });

  return { amount };
}

export async function getPartnerDashboard(userId: string) {
  const profile = await ensurePartnerProfile(userId);

  let mainLink = await prisma.partnerLink.findFirst({
    where: { partnerId: profile.id, slug: "main" },
  });
  if (!mainLink) {
    mainLink = await prisma.partnerLink.create({
      data: { partnerId: profile.id, slug: "main", label: "Основная" },
    });
  }

  const links = await prisma.partnerLink.findMany({
    where: { partnerId: profile.id },
    orderBy: { createdAt: "asc" },
  });

  const referrals = await prisma.partnerAttribution.count({
    where: { partnerId: profile.id },
  });

  const [purchaseCount, purchaseAgg] = await Promise.all([
    prisma.partnerCommission.count({
      where: { partnerId: profile.id, amountPeaches: { gt: 0 } },
    }),
    prisma.partnerCommission.aggregate({
      where: { partnerId: profile.id },
      _sum: { grossPeaches: true, amountPeaches: true },
    }),
  ]);

  const commissions = await prisma.partnerCommission.findMany({
    where: { partnerId: profile.id },
    orderBy: { createdAt: "desc" },
    take: 30,
  });

  const withdrawals = await prisma.partnerWithdrawal.findMany({
    where: { partnerId: profile.id },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  const botUsername = await getPrimaryBotUsername();

  const dash = {
    profile,
    links,
    referrals,
    purchases: purchaseCount,
    purchaseGrossPeaches: purchaseAgg._sum.grossPeaches || 0,
    commissionPeaches:
      purchaseAgg._sum.amountPeaches || profile.totalEarnedPeaches,
    commissions,
    withdrawals,
    botUsername,
    mainLink,
  };

  const tgAcc = await prisma.platformAccount.findFirst({
    where: { userId, platform: "telegram" },
    select: { platformUserId: true },
  });
  const demo =
    tgAcc && DEMO_PARTNER_BY_TG[String(tgAcc.platformUserId)];
  if (demo) {
    const demoBySlug = new Map(
      (demo.links || []).map((l) => [l.slug, l] as const),
    );
    const links = dash.links.map((link) => {
      const ov = demoBySlug.get(link.slug);
      if (!ov) return link;
      return {
        ...link,
        clicks: ov.clicks,
        signups: ov.signups,
        purchases: ov.purchases,
        purchaseGrossPeaches: ov.purchaseGrossPeaches,
        commissionPeaches: ov.commissionPeaches,
      };
    });
    return {
      ...dash,
      links,
      referrals: demo.referrals,
      purchases: demo.purchases,
      purchaseGrossPeaches: demo.purchaseGrossPeaches,
      commissionPeaches: demo.commissionPeaches,
      profile: {
        ...profile,
        balancePeaches: demo.balancePeaches,
        totalEarnedPeaches: demo.totalEarnedPeaches,
        commissionPct: demo.commissionPct,
      },
    };
  }

  return dash;
}

export async function createPartnerLink(
  userId: string,
  label: string,
  slug?: string,
) {
  const profile = await ensurePartnerProfile(userId);
  const cleanSlug =
    (slug || label)
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "_")
      .replace(/^_|_$/g, "")
      .slice(0, 32) || randomCode(6);

  return prisma.partnerLink.create({
    data: {
      partnerId: profile.id,
      slug: cleanSlug,
      label: label.trim().slice(0, 80) || cleanSlug,
    },
  });
}

/** Merchant settlement hold before partner commission is withdrawable. */
export const PARTNER_COMMISSION_FREEZE_MS = 3 * 24 * 60 * 60 * 1000;

/** Raw sum of positive commissions younger than the freeze window (may exceed balance). */
export async function partnerFrozenCommissionPeachesByIds(
  partnerIds: string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!partnerIds.length) return out;
  const since = new Date(Date.now() - PARTNER_COMMISSION_FREEZE_MS);
  const rows = await prisma.partnerCommission.groupBy({
    by: ["partnerId"],
    where: {
      partnerId: { in: partnerIds },
      createdAt: { gt: since },
      amountPeaches: { gt: 0 },
    },
    _sum: { amountPeaches: true },
  });
  for (const r of rows) {
    out.set(r.partnerId, Math.max(0, r._sum.amountPeaches || 0));
  }
  return out;
}

/** Part of balance still in merchant hold (≤ balance). */
export function partnerHoldOnBalance(
  balancePeaches: number,
  frozenCommissions: number,
): number {
  return Math.min(
    Math.max(0, balancePeaches),
    Math.max(0, frozenCommissions),
  );
}

/** Balance minus commissions younger than the merchant freeze window. */
export async function partnerWithdrawAvailablePeaches(
  partnerId: string,
  balancePeaches: number,
): Promise<number> {
  const map = await partnerFrozenCommissionPeachesByIds([partnerId]);
  const frozen = map.get(partnerId) || 0;
  return Math.max(0, balancePeaches - frozen);
}

export async function requestPartnerWithdrawal(opts: {
  userId: string;
  amountPeaches: number;
  payoutDetails: string;
}) {
  const profile = await ensurePartnerProfile(opts.userId);
  const min = 500;
  if (opts.amountPeaches < min) {
    throw new Error(`Минимум для вывода: ${min}₽`);
  }
  if (profile.balancePeaches < opts.amountPeaches) {
    throw new Error("Недостаточно на партнёрском балансе");
  }
  if (!opts.payoutDetails.trim()) {
    throw new Error("Укажи реквизиты (USDT TRC20 / карта)");
  }

  const available = await partnerWithdrawAvailablePeaches(
    profile.id,
    profile.balancePeaches,
  );
  if (opts.amountPeaches > available) {
    throw new Error(
      `К сожалению, сейчас можно создать заявку не больше ${available}₽. Мерчант замораживает оплаты на 3 суток — потом сумма доступна к выводу.`,
    );
  }

  return prisma.$transaction(async (tx) => {
    await tx.partnerProfile.update({
      where: { id: profile.id },
      data: { balancePeaches: { decrement: opts.amountPeaches } },
    });
    return tx.partnerWithdrawal.create({
      data: {
        partnerId: profile.id,
        amountPeaches: opts.amountPeaches,
        payoutDetails: opts.payoutDetails.trim().slice(0, 500),
        status: "pending",
      },
    });
  });
}

export function partnerStartLink(botUsername: string, code: string, linkSlug?: string) {
  const payload = linkSlug ? `ref_${code}${LINK_SEP}${linkSlug}` : `ref_${code}`;
  return `https://t.me/${botUsername}?start=${payload}`;
}

/** Permanent domain bridge (pichbitch.live) — bot nick lives only in bot.txt on host. */
export const PARTNER_BRIDGE_ORIGIN = (
  process.env.PARTNER_BRIDGE_ORIGIN?.trim() || "https://pichbitch.live"
).replace(/\/$/, "");

export function partnerBridgeLink(code: string, linkSlug?: string) {
  const base = `${PARTNER_BRIDGE_ORIGIN}/ref${encodeURIComponent(code)}`;
  if (linkSlug && linkSlug !== "main") {
    return `${base}/${encodeURIComponent(linkSlug)}`;
  }
  return base;
}
