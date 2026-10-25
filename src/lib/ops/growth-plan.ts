/**
 * Profit plan for /ops/growth.
 *
 * Cohort block: people whose first /start fell in the Moscow window
 * (same registration as /ops/sales). Their payments and partner
 * commissions are counted through now, so a recent day is still immature.
 *
 * Day table: cash that arrived on that Moscow day, minus partner
 * commissions created that day. Excluded partners leave both blocks.
 *
 * Net = revenue − partner commissions − payment fee − GPU/day.
 * Fee and GPU default to 0, so net matches «выручка минус партнёры».
 */
import { prisma } from "@/lib/db";
import {
  addYmdDays,
  listSalesPartners,
  mskDayStartUtc,
  mskYmd,
} from "@/lib/ops/sales-analytics";

const START_EVENT_KEYS = [
  "bot.start",
  "bot.start.returning",
  "bot.start.photos_upload",
];

const MONTH_DAYS = 30;
const MAX_SPAN_DAYS = 800;
const CHUNK = 200;

export type GrowthSettings = {
  monthlyNetGoalRub: number;
  paymentFeePct: number;
  gpuDailyRub: number;
  excludedPartnerIds: string[];
};

export type LangSlice = {
  total: number;
  known: number;
  ru: number;
  /** ru / known, null when nobody has a Telegram language. */
  ruShare: number | null;
  top: { code: string; count: number }[];
};

export type GrowthDashboard = {
  from: string;
  to: string;
  today: string;
  days: number;
  minYmd: string | null;
  settings: GrowthSettings;
  cohort: {
    regs: number;
    ownRegs: number;
    partnerRegs: number;
    firstPayers: number;
    crFirst: number | null;
    avgCheckFirstRub: number | null;
    repeatPayments: number;
    repeatPayers: number;
    crRepeat: number | null;
    avgCheckRepeatRub: number | null;
    revenueRub: number;
    partnerRub: number;
    feeRub: number;
    gpuRub: number;
    netRub: number;
    profitPerRegRub: number | null;
    ruOwn: LangSlice;
    ruPartner: LangSlice;
  };
  plan: {
    goalRub: number;
    revenueNeedMonth: number | null;
    margin: number | null;
    profitPerRegRub: number | null;
    ownProfitPerRegRub: number | null;
    blendedMonth: number | null;
    ownOfBlendMonth: number | null;
    partnerOfBlendMonth: number | null;
    ownOnlyMonth: number | null;
    nowRegsPerDay: number;
    nowOwnPerDay: number;
    nowPartnerPerDay: number;
    /** Why the volume cannot be computed. */
    block: "no-goal" | "no-regs" | "no-revenue" | "no-margin" | null;
    ownBlock: "no-own" | "own-no-margin" | null;
  };
  own: {
    regs: number;
    payers: number;
    revenueRub: number;
    partnerRub: number;
    netRub: number;
    ru: LangSlice;
  };
  excluded: {
    partners: number;
    regs: number;
    revenueRub: number;
    cashRub: number;
    ru: LangSlice;
  };
  partners: {
    id: string;
    code: string;
    name: string | null;
    commissionPct: number;
    status: string;
    excluded: boolean;
    regs: number;
    payers: number;
    revenueRub: number;
    partnerRub: number;
    netRub: number;
    ru: LangSlice;
    /** Enough known languages and less than half Russian. */
    ruThin: boolean;
  }[];
  cash: {
    revenueRub: number;
    partnerRub: number;
    feeRub: number;
    gpuRub: number;
    netRub: number;
    normRub: number | null;
    gapDays: number | null;
  };
  /** Newest day first. */
  dayRows: {
    ymd: string;
    revenueRub: number;
    partnerRub: number;
    netRub: number;
    cumNetRub: number;
    pacePct: number | null;
    gapDays: number | null;
  }[];
};

type RatesInput = {
  revenueRub: number;
  partnerRub: number;
  ownRevenueRub: number;
  ownPartnerRub: number;
  feePct: number;
  gpuDailyRub: number;
  regs: number;
  ownRegs: number;
  goalMonthRub: number;
  days: number;
};

export function volumeFromRates(input: RatesInput): GrowthDashboard["plan"] {
  const fee = clampFee(input.feePct) / 100;
  const regs = input.regs;
  const ownRegs = input.ownRegs;
  const partnerRegs = Math.max(0, regs - ownRegs);
  const days = Math.max(1, input.days);
  const variable = input.revenueRub * (1 - fee) - input.partnerRub;
  const profitPerReg = regs > 0 ? variable / regs : null;
  const ownVariable = input.ownRevenueRub * (1 - fee) - input.ownPartnerRub;
  const ownProfit = ownRegs > 0 ? ownVariable / ownRegs : null;
  const margin = input.revenueRub > 0 ? variable / input.revenueRub : null;
  const goal = input.goalMonthRub;
  const needNet = goal + input.gpuDailyRub * MONTH_DAYS;

  let block: GrowthDashboard["plan"]["block"] = null;
  let revenueNeed: number | null = null;
  let blended: number | null = null;
  if (goal <= 0) block = "no-goal";
  else if (regs <= 0) block = "no-regs";
  else if (input.revenueRub <= 0) block = "no-revenue";
  else if (margin == null || margin <= 0.0001 || profitPerReg == null || profitPerReg <= 0.01) {
    block = "no-margin";
  } else {
    revenueNeed = needNet / margin;
    blended = needNet / profitPerReg;
  }

  let ownBlock: GrowthDashboard["plan"]["ownBlock"] = null;
  let ownOnly: number | null = null;
  if (goal > 0) {
    if (ownRegs <= 0) ownBlock = "no-own";
    else if (ownProfit == null || ownProfit <= 0.01) ownBlock = "own-no-margin";
    else ownOnly = needNet / ownProfit;
  }

  const ownShare = regs > 0 ? ownRegs / regs : 0;
  const partnerShare = regs > 0 ? partnerRegs / regs : 0;

  return {
    goalRub: goal,
    revenueNeedMonth: revenueNeed,
    margin,
    profitPerRegRub: profitPerReg,
    ownProfitPerRegRub: ownProfit,
    blendedMonth: blended,
    ownOfBlendMonth: blended == null ? null : blended * ownShare,
    partnerOfBlendMonth: blended == null ? null : blended * partnerShare,
    ownOnlyMonth: ownOnly,
    nowRegsPerDay: regs / days,
    nowOwnPerDay: ownRegs / days,
    nowPartnerPerDay: partnerRegs / days,
    block,
    ownBlock,
  };
}

function clampFee(n: number): number {
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(80, n);
}

function finishLang(b: { total: number; known: number; ru: number; codes: Map<string, number> }): LangSlice {
  const top = [...b.codes.entries()]
    .sort((a, c) => c[1] - a[1] || a[0].localeCompare(c[0]))
    .slice(0, 4)
    .map(([code, count]) => ({ code, count }));
  return {
    total: b.total,
    known: b.known,
    ru: b.ru,
    ruShare: b.known > 0 ? b.ru / b.known : null,
    top,
  };
}

function isRuCode(code: string | null | undefined): boolean {
  return (code || "").trim().toLowerCase().startsWith("ru");
}

function listYmd(from: string, to: string): string[] {
  const out: string[] = [];
  let cur = from;
  for (let i = 0; i < MAX_SPAN_DAYS && cur <= to; i++) {
    out.push(cur);
    cur = addYmdDays(cur, 1);
  }
  return out;
}

function spanDays(from: string, to: string): number {
  return listYmd(from, to).length;
}

async function mapChunks<T>(
  ids: string[],
  fn: (chunk: string[]) => Promise<T[]>,
): Promise<T[]> {
  if (!ids.length) return [];
  const jobs: Promise<T[]>[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    jobs.push(fn(ids.slice(i, i + CHUNK)));
  }
  const parts = await Promise.all(jobs);
  return parts.flat();
}

export async function ensureGrowthPlanTable(): Promise<void> {
  const url = process.env.DATABASE_URL || "";
  if (url.startsWith("postgres")) {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "GrowthPlan" (
        "id" TEXT NOT NULL,
        "monthlyNetGoalRub" INTEGER NOT NULL DEFAULT 0,
        "paymentFeePct" DOUBLE PRECISION NOT NULL DEFAULT 0,
        "gpuDailyRub" INTEGER NOT NULL DEFAULT 0,
        "excludedPartnerIdsJson" TEXT NOT NULL DEFAULT '[]',
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "GrowthPlan_pkey" PRIMARY KEY ("id")
      )
    `);
    return;
  }
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "GrowthPlan" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "monthlyNetGoalRub" INTEGER NOT NULL DEFAULT 0,
      "paymentFeePct" REAL NOT NULL DEFAULT 0,
      "gpuDailyRub" INTEGER NOT NULL DEFAULT 0,
      "excludedPartnerIdsJson" TEXT NOT NULL DEFAULT '[]',
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

function parseExcluded(raw: string): string[] {
  try {
    const v = JSON.parse(raw) as unknown;
    if (!Array.isArray(v)) return [];
    return [...new Set(v.filter((x): x is string => typeof x === "string" && x.length > 0))];
  } catch {
    return [];
  }
}

export async function loadGrowthSettings(): Promise<GrowthSettings> {
  await ensureGrowthPlanTable();
  const row = await prisma.growthPlan.findUnique({ where: { id: "main" } });
  if (!row) {
    return {
      monthlyNetGoalRub: 0,
      paymentFeePct: 0,
      gpuDailyRub: 0,
      excludedPartnerIds: [],
    };
  }
  return {
    monthlyNetGoalRub: Math.max(0, row.monthlyNetGoalRub),
    paymentFeePct: clampFee(row.paymentFeePct),
    gpuDailyRub: Math.max(0, row.gpuDailyRub),
    excludedPartnerIds: parseExcluded(row.excludedPartnerIdsJson),
  };
}

export async function saveGrowthSettings(
  patch: Partial<GrowthSettings>,
): Promise<GrowthSettings> {
  const current = await loadGrowthSettings();
  const next: GrowthSettings = {
    monthlyNetGoalRub:
      patch.monthlyNetGoalRub == null
        ? current.monthlyNetGoalRub
        : Math.max(0, Math.round(patch.monthlyNetGoalRub)),
    paymentFeePct:
      patch.paymentFeePct == null ? current.paymentFeePct : clampFee(patch.paymentFeePct),
    gpuDailyRub:
      patch.gpuDailyRub == null
        ? current.gpuDailyRub
        : Math.max(0, Math.round(patch.gpuDailyRub)),
    excludedPartnerIds:
      patch.excludedPartnerIds == null
        ? current.excludedPartnerIds
        : [...new Set(patch.excludedPartnerIds.filter(Boolean))],
  };
  if (next.monthlyNetGoalRub > 1_000_000_000) {
    throw new Error("Цель слишком большая");
  }
  if (next.gpuDailyRub > 10_000_000) {
    throw new Error("Сумма карт в день слишком большая");
  }
  if (next.excludedPartnerIds.length > 500) {
    throw new Error("Слишком много исключений");
  }
  const known = new Set((await listSalesPartners()).map((p) => p.id));
  next.excludedPartnerIds = next.excludedPartnerIds.filter((id) => known.has(id));

  await prisma.growthPlan.upsert({
    where: { id: "main" },
    create: {
      id: "main",
      monthlyNetGoalRub: next.monthlyNetGoalRub,
      paymentFeePct: next.paymentFeePct,
      gpuDailyRub: next.gpuDailyRub,
      excludedPartnerIdsJson: JSON.stringify(next.excludedPartnerIds),
    },
    update: {
      monthlyNetGoalRub: next.monthlyNetGoalRub,
      paymentFeePct: next.paymentFeePct,
      gpuDailyRub: next.gpuDailyRub,
      excludedPartnerIdsJson: JSON.stringify(next.excludedPartnerIds),
    },
  });
  return next;
}

type Person = {
  id: string;
  partnerId: string | null;
  lang: string | null;
};

type Pay = { minor: number; at: Date };

export async function collectGrowthPlan(fromYmd: string, toYmd: string): Promise<GrowthDashboard> {
  const today = mskYmd();
  const boundsMin = await prisma.user.findFirst({
    where: { source: "telegram" },
    orderBy: { createdAt: "asc" },
    select: { createdAt: true },
  });
  const minYmd = boundsMin ? mskYmd(boundsMin.createdAt) : null;

  let from = fromYmd;
  let to = toYmd;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) from = addYmdDays(today, -29);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(to)) to = today;
  if (from > to) {
    const swap = from;
    from = to;
    to = swap;
  }
  if (to > today) to = today;
  const days = spanDays(from, to);
  if (days < 1 || days > MAX_SPAN_DAYS) {
    throw new Error("Период длиннее 800 дней — сузьте даты");
  }

  const settings = await loadGrowthSettings();
  const excluded = new Set(settings.excludedPartnerIds);
  const feeRate = clampFee(settings.paymentFeePct) / 100;
  const fromDt = mskDayStartUtc(from);
  const toDt = mskDayStartUtc(addYmdDays(to, 1));

  const [partnerRows, groups] = await Promise.all([
    prisma.partnerProfile.findMany({
      orderBy: { code: "asc" },
      select: {
        id: true,
        code: true,
        commissionPct: true,
        status: true,
        user: { select: { name: true } },
      },
    }),
    prisma.funnelEvent.groupBy({
      by: ["userId"],
      where: {
        eventKey: { in: START_EVENT_KEYS },
        user: { source: "telegram" },
      },
      _min: { at: true },
      having: { at: { _min: { gte: fromDt, lt: toDt } } },
    }),
  ]);

  const cohortIds = groups.map((g) => g.userId);
  const peopleRows = await mapChunks(cohortIds, (chunk) =>
    prisma.user.findMany({
      where: { id: { in: chunk } },
      select: {
        id: true,
        partnerAttribution: { select: { partnerId: true } },
        platformAccounts: {
          where: { platform: "telegram" },
          select: { languageCode: true },
          orderBy: { lastSeenAt: "desc" },
          take: 1,
        },
      },
    }),
  );

  const people: Person[] = peopleRows.map((u) => ({
    id: u.id,
    partnerId: u.partnerAttribution?.partnerId ?? null,
    lang: (u.platformAccounts[0]?.languageCode || "").trim().toLowerCase() || null,
  }));

  const included = people.filter((p) => !p.partnerId || !excluded.has(p.partnerId));
  const excludedPeople = people.filter((p) => p.partnerId && excluded.has(p.partnerId));
  const includedIds = included.map((p) => p.id);

  const [pays, commissions] = await Promise.all([
    mapChunks(includedIds.concat(excludedPeople.map((p) => p.id)), (chunk) =>
      prisma.paymentOrder.findMany({
        where: { userId: { in: chunk }, status: "paid", paidAt: { not: null } },
        select: { userId: true, amountMinor: true, paidAt: true },
        orderBy: { paidAt: "asc" },
      }),
    ),
    mapChunks(includedIds.concat(excludedPeople.map((p) => p.id)), (chunk) =>
      prisma.partnerCommission.findMany({
        where: { referredUserId: { in: chunk } },
        select: {
          referredUserId: true,
          partnerId: true,
          amountPeaches: true,
        },
      }),
    ),
  ]);

  const paysByUser = new Map<string, Pay[]>();
  for (const o of pays) {
    if (!o.paidAt) continue;
    const list = paysByUser.get(o.userId) || [];
    list.push({ minor: o.amountMinor, at: o.paidAt });
    paysByUser.set(o.userId, list);
  }
  for (const list of paysByUser.values()) {
    list.sort((a, b) => a.at.getTime() - b.at.getTime());
  }

  const commByUser = new Map<string, number>();
  for (const c of commissions) {
    commByUser.set(
      c.referredUserId,
      (commByUser.get(c.referredUserId) || 0) + c.amountPeaches,
    );
  }

  type Acc = {
    regs: number;
    payers: number;
    repeatPayers: number;
    repeatPayments: number;
    firstMinor: number;
    repeatMinor: number;
    revenueMinor: number;
    partnerRub: number;
    lang: { total: number; known: number; ru: number; codes: Map<string, number> };
  };
  function blankAcc(): Acc {
    return {
      regs: 0,
      payers: 0,
      repeatPayers: 0,
      repeatPayments: 0,
      firstMinor: 0,
      repeatMinor: 0,
      revenueMinor: 0,
      partnerRub: 0,
      lang: { total: 0, known: 0, ru: 0, codes: new Map() },
    };
  }
  function addPerson(acc: Acc, person: Person) {
    acc.regs += 1;
    acc.lang.total += 1;
    if (person.lang) {
      acc.lang.known += 1;
      acc.lang.codes.set(person.lang, (acc.lang.codes.get(person.lang) || 0) + 1);
      if (isRuCode(person.lang)) acc.lang.ru += 1;
    }
    const list = paysByUser.get(person.id) || [];
    if (list.length) {
      acc.payers += 1;
      acc.firstMinor += list[0]!.minor;
      if (list.length > 1) acc.repeatPayers += 1;
      for (let i = 1; i < list.length; i++) {
        acc.repeatPayments += 1;
        acc.repeatMinor += list[i]!.minor;
      }
      for (const p of list) acc.revenueMinor += p.minor;
    }
    acc.partnerRub += commByUser.get(person.id) || 0;
  }

  const all = blankAcc();
  const own = blankAcc();
  const partnerSide = blankAcc();
  const leftOut = blankAcc();
  const byPartner = new Map<string, Acc>();

  for (const person of included) {
    addPerson(all, person);
    if (person.partnerId) {
      addPerson(partnerSide, person);
      const bucket = byPartner.get(person.partnerId) || blankAcc();
      addPerson(bucket, person);
      byPartner.set(person.partnerId, bucket);
    } else {
      addPerson(own, person);
    }
  }
  for (const person of excludedPeople) {
    addPerson(leftOut, person);
    if (!person.partnerId) continue;
    const bucket = byPartner.get(person.partnerId) || blankAcc();
    addPerson(bucket, person);
    byPartner.set(person.partnerId, bucket);
  }

  const revenueRub = all.revenueMinor / 100;
  const ownRevenueRub = own.revenueMinor / 100;
  const feeRub = revenueRub * feeRate;
  const gpuRub = settings.gpuDailyRub * days;
  const netRub = revenueRub - all.partnerRub - feeRub - gpuRub;

  const plan = volumeFromRates({
    revenueRub,
    partnerRub: all.partnerRub,
    ownRevenueRub,
    ownPartnerRub: own.partnerRub,
    feePct: settings.paymentFeePct,
    gpuDailyRub: settings.gpuDailyRub,
    regs: all.regs,
    ownRegs: own.regs,
    goalMonthRub: settings.monthlyNetGoalRub,
    days,
  });

  const cashOrders = await prisma.paymentOrder.findMany({
    where: { status: "paid", paidAt: { gte: fromDt, lt: toDt } },
    select: { userId: true, amountMinor: true, paidAt: true },
  });
  const cashUserIds = [...new Set(cashOrders.map((o) => o.userId))];
  const cashAttrs = await mapChunks(cashUserIds, (chunk) =>
    prisma.partnerAttribution.findMany({
      where: { userId: { in: chunk } },
      select: { userId: true, partnerId: true },
    }),
  );
  const cashPartnerByUser = new Map(cashAttrs.map((a) => [a.userId, a.partnerId]));

  const dayRevenue = new Map<string, number>();
  let excludedCashMinor = 0;
  for (const o of cashOrders) {
    if (!o.paidAt) continue;
    const pid = cashPartnerByUser.get(o.userId);
    if (pid && excluded.has(pid)) {
      excludedCashMinor += o.amountMinor;
      continue;
    }
    const ymd = mskYmd(o.paidAt);
    dayRevenue.set(ymd, (dayRevenue.get(ymd) || 0) + o.amountMinor);
  }

  const cashCommissions = await prisma.partnerCommission.findMany({
    where: {
      createdAt: { gte: fromDt, lt: toDt },
      ...(excluded.size ? { partnerId: { notIn: [...excluded] } } : {}),
    },
    select: { amountPeaches: true, createdAt: true },
  });
  const dayPartner = new Map<string, number>();
  for (const c of cashCommissions) {
    const ymd = mskYmd(c.createdAt);
    dayPartner.set(ymd, (dayPartner.get(ymd) || 0) + c.amountPeaches);
  }

  const dailyGoal = settings.monthlyNetGoalRub > 0 ? settings.monthlyNetGoalRub / MONTH_DAYS : null;
  const ymds = listYmd(from, to);
  let cum = 0;
  const chrono = ymds.map((ymd, index) => {
    const revenue = (dayRevenue.get(ymd) || 0) / 100;
    const partner = dayPartner.get(ymd) || 0;
    const fee = revenue * feeRate;
    const net = revenue - partner - fee - settings.gpuDailyRub;
    cum += net;
    const expected = dailyGoal == null ? null : dailyGoal * (index + 1);
    return {
      ymd,
      revenueRub: revenue,
      partnerRub: partner,
      netRub: net,
      cumNetRub: cum,
      pacePct: dailyGoal ? (net / dailyGoal) * 100 : null,
      gapDays: dailyGoal && expected != null ? (expected - cum) / dailyGoal : null,
    };
  });

  const cashRevenue = chrono.reduce((s, r) => s + r.revenueRub, 0);
  const cashPartner = chrono.reduce((s, r) => s + r.partnerRub, 0);
  const cashFee = cashRevenue * feeRate;
  const cashGpu = settings.gpuDailyRub * days;
  const cashNet = chrono.length ? chrono[chrono.length - 1]!.cumNetRub : 0;
  const lastGap = chrono.length ? chrono[chrono.length - 1]!.gapDays : null;

  function sliceOf(acc: Acc): LangSlice {
    return finishLang(acc.lang);
  }
  function cr(num: number, den: number): number | null {
    return den > 0 ? num / den : null;
  }

  const partners = partnerRows.map((p) => {
    const acc = byPartner.get(p.id) || blankAcc();
    const rev = acc.revenueMinor / 100;
    const net = rev - acc.partnerRub;
    const ru = sliceOf(acc);
    return {
      id: p.id,
      code: p.code,
      name: p.user.name,
      commissionPct: p.commissionPct,
      status: p.status,
      excluded: excluded.has(p.id),
      regs: acc.regs,
      payers: acc.payers,
      revenueRub: rev,
      partnerRub: acc.partnerRub,
      netRub: net,
      ru,
      ruThin: ru.known >= 8 && (ru.ruShare ?? 1) < 0.5,
    };
  });
  partners.sort((a, b) => {
    if (a.excluded !== b.excluded) return a.excluded ? 1 : -1;
    return b.regs - a.regs || a.code.localeCompare(b.code);
  });

  return {
    from,
    to,
    today,
    days,
    minYmd,
    settings,
    cohort: {
      regs: all.regs,
      ownRegs: own.regs,
      partnerRegs: partnerSide.regs,
      firstPayers: all.payers,
      crFirst: cr(all.payers, all.regs),
      avgCheckFirstRub: all.payers > 0 ? all.firstMinor / 100 / all.payers : null,
      repeatPayments: all.repeatPayments,
      repeatPayers: all.repeatPayers,
      crRepeat: cr(all.repeatPayers, all.payers),
      avgCheckRepeatRub:
        all.repeatPayments > 0 ? all.repeatMinor / 100 / all.repeatPayments : null,
      revenueRub,
      partnerRub: all.partnerRub,
      feeRub,
      gpuRub,
      netRub,
      profitPerRegRub: plan.profitPerRegRub,
      ruOwn: sliceOf(own),
      ruPartner: sliceOf(partnerSide),
    },
    plan,
    own: {
      regs: own.regs,
      payers: own.payers,
      revenueRub: ownRevenueRub,
      partnerRub: own.partnerRub,
      netRub: ownRevenueRub - own.partnerRub,
      ru: sliceOf(own),
    },
    excluded: {
      partners: excluded.size,
      regs: leftOut.regs,
      revenueRub: leftOut.revenueMinor / 100,
      cashRub: excludedCashMinor / 100,
      ru: sliceOf(leftOut),
    },
    partners,
    cash: {
      revenueRub: cashRevenue,
      partnerRub: cashPartner,
      feeRub: cashFee,
      gpuRub: cashGpu,
      netRub: cashNet,
      normRub: dailyGoal == null ? null : dailyGoal * days,
      gapDays: lastGap,
    },
    dayRows: chrono.slice().reverse(),
  };
}
