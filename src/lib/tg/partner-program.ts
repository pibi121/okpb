/**
 * TG partner program — referrals, commissions, withdrawals.
 */
import { prisma } from "@/lib/db";
import { randomBytes } from "crypto";

const LINK_SEP = "__";

/**
 * TEMP demo overlay for partner Mini App / bot «Заработать».
 * Display-only — does not write to DB or allow real withdrawals of fake balance.
 * Remove when real stats are ready.
 */
const DEMO_PARTNER_TG_IDS = new Set(["8762393340"]);
const DEMO_PARTNER_STATS = {
  referrals: 88,
  purchases: 9,
  purchaseGrossPeaches: 6441,
  commissionPeaches: 3220,
  balancePeaches: 3220,
  totalEarnedPeaches: 3220,
  commissionPct: 50,
} as const;

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
}) {
  if (opts.grossPeaches <= 0) return;
  const attr = await prisma.partnerAttribution.findUnique({
    where: { userId: opts.referredUserId },
    include: { partner: true },
  });
  if (!attr || attr.partner.status !== "active") return;

  const pct = attr.partner.commissionPct || 50;
  const amount = Math.floor((opts.grossPeaches * pct) / 100);
  if (amount <= 0) return;

  await prisma.$transaction(async (tx) => {
    await tx.partnerProfile.update({
      where: { id: attr.partnerId },
      data: {
        balancePeaches: { increment: amount },
        totalEarnedPeaches: { increment: amount },
      },
    });
    await tx.partnerCommission.create({
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
  });
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

  const purchaseAgg = await prisma.partnerCommission.aggregate({
    where: { partnerId: profile.id },
    _count: { id: true },
    _sum: { grossPeaches: true, amountPeaches: true },
  });

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

  const botUsername = process.env.TELEGRAM_BOT_USERNAME || "peachbibot";

  const dash = {
    profile,
    links,
    referrals,
    purchases: purchaseAgg._count.id,
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
  if (tgAcc && DEMO_PARTNER_TG_IDS.has(String(tgAcc.platformUserId))) {
    return {
      ...dash,
      referrals: DEMO_PARTNER_STATS.referrals,
      purchases: DEMO_PARTNER_STATS.purchases,
      purchaseGrossPeaches: DEMO_PARTNER_STATS.purchaseGrossPeaches,
      commissionPeaches: DEMO_PARTNER_STATS.commissionPeaches,
      profile: {
        ...profile,
        balancePeaches: DEMO_PARTNER_STATS.balancePeaches,
        totalEarnedPeaches: DEMO_PARTNER_STATS.totalEarnedPeaches,
        commissionPct: DEMO_PARTNER_STATS.commissionPct,
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

export async function requestPartnerWithdrawal(opts: {
  userId: string;
  amountPeaches: number;
  payoutDetails: string;
}) {
  const profile = await ensurePartnerProfile(opts.userId);
  const min = 500;
  if (opts.amountPeaches < min) {
    throw new Error(`Минимум для вывода: ${min} 🍑`);
  }
  if (profile.balancePeaches < opts.amountPeaches) {
    throw new Error("Недостаточно на партнёрском балансе");
  }
  if (!opts.payoutDetails.trim()) {
    throw new Error("Укажи реквизиты (USDT TRC20 / карта)");
  }

  const pending = await prisma.partnerWithdrawal.count({
    where: { partnerId: profile.id, status: "pending" },
  });
  if (pending > 0) throw new Error("Уже есть заявка на вывод — дождись обработки");

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
