/**
 * OPS sales analytics: cohort-by-signup funnel + cash-by-paidAt widget.
 * Dates are Europe/Moscow calendar days.
 */
import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";

const MSK = "Europe/Moscow";
const MSK_OFFSET_MS = 3 * 3600_000;

export type SalesCurrency = "rub" | "peaches" | "both";
export type SalesGrain = "day" | "week";

export type SalesFunnelStepDef = {
  key: string;
  title: string;
  /** Funnel eventKey; null = synthetic (registrations / paid order) */
  eventKey: string | null;
  kind: "cohort" | "event" | "paid";
};

/** Fixed sales funnel: cohort start → monetization. Short OPS titles. */
export const SALES_FUNNEL_STEPS: SalesFunnelStepDef[] = [
  {
    key: "registered",
    title: "Регистрация",
    eventKey: null,
    kind: "cohort",
  },
  {
    key: "bot.start",
    title: "Открыл бота (/start)",
    eventKey: "bot.start",
    kind: "event",
  },
  {
    key: "bot.rules.agree",
    title: "Согласился с правилами (18+)",
    eventKey: "bot.rules.agree",
    kind: "event",
  },
  {
    key: "bot.welcome.after_rules",
    title: "Показал welcome после правил",
    eventKey: "bot.welcome.after_rules",
    kind: "event",
  },
  {
    key: "bot.gen.started",
    title: "Запустил генерацию",
    eventKey: "bot.gen.started",
    kind: "event",
  },
  {
    key: "bot.topup.open",
    title: "Открыл пополнение",
    eventKey: "bot.topup.open",
    kind: "event",
  },
  {
    key: "paid",
    title: "Сделал первую оплату",
    eventKey: null,
    kind: "paid",
  },
];

export type SalesAnalyticsParams = {
  fromYmd: string;
  toYmd: string;
  currency: SalesCurrency;
  grain: SalesGrain;
};

export type FunnelStepRow = {
  key: string;
  title: string;
  uniqueUsers: number;
  /** % of cohort start */
  pctOfStart: number;
  /** % of previous step */
  pctOfPrev: number;
  /** For paid step: paid within 7d of signup */
  uniqueWithin7d?: number;
  pctWithin7dOfStart?: number;
};

export type SalesAnalyticsResult = {
  meta: {
    fromYmd: string;
    toYmd: string;
    fromIso: string;
    toIsoExclusive: string;
    currency: SalesCurrency;
    grain: SalesGrain;
    minSignupYmd: string | null;
    maxYmd: string;
    note: string;
  };
  kpi: {
    /** Cohort size: telegram users created in window */
    newUsers: number;
    /** All paid PaymentOrders by cohort users (ever, as of report) */
    paymentsCount: number;
    avgMsToFirstPay: number | null;
    medianMsToFirstPay: number | null;
    /** Cohort ₽ revenue / registrations */
    revenuePerRegRub: number;
    /** Cohort 🍑 topups / registrations */
    revenuePerRegPeaches: number;
    /** paymentsCount / registrations */
    paymentsPerReg: number;
    /** Kept for funnel «первая оплата» / ≤7д */
    payers: number;
    payersWithin7d: number;
  };
  cash: {
    note: string;
    rubMinor: number;
    rub: number;
    peaches: number;
    /** Paid PaymentOrder count in window */
    paymentsCount: number;
    /** Unique payers by PaymentOrder in window (₽) */
    rubPayers: number;
    /** Unique users with live topup ledger in window (🍑) */
    peachPayers: number;
    methods: { method: string; count: number; rubMinor: number; peaches: number }[];
  };
  funnel: FunnelStepRow[];
  series: {
    grain: SalesGrain;
    buckets: {
      key: string;
      label: string;
      fromYmd: string;
      toYmd: string;
      registrations: number;
      cohortPaid: number;
      cashRub: number;
      cashPeaches: number;
      cashPayments: number;
    }[];
  };
};

export function mskYmd(d = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: MSK,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** MSK calendar midnight → UTC Instant */
export function mskDayStartUtc(ymd: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) throw new Error(`Некорректная дата: ${ymd}`);
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const day = Number(m[3]);
  return new Date(Date.UTC(y, mo - 1, day, 0, 0, 0, 0) - MSK_OFFSET_MS);
}

export function addYmdDays(ymd: string, delta: number): string {
  const start = mskDayStartUtc(ymd);
  return mskYmd(new Date(start.getTime() + delta * 86_400_000 + MSK_OFFSET_MS / 2));
}

function isValidYmd(s: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(mskDayStartUtc(s).getTime());
}

/** Monday (MSK) of the week containing ymd */
function mskWeekMonday(ymd: string): string {
  const start = mskDayStartUtc(ymd);
  const shifted = new Date(start.getTime() + MSK_OFFSET_MS);
  const dow = shifted.getUTCDay(); // 0=Sun … 6=Sat
  const mondayOffset = dow === 0 ? -6 : 1 - dow;
  return addYmdDays(ymd, mondayOffset);
}

function weekLabel(monYmd: string): string {
  const sun = addYmdDays(monYmd, 6);
  return `${monYmd.slice(5)}–${sun.slice(5)}`;
}

function median(nums: number[]): number | null {
  if (!nums.length) return null;
  const a = [...nums].sort((x, y) => x - y);
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid]! : Math.round((a[mid - 1]! + a[mid]!) / 2);
}

function mean(nums: number[]): number | null {
  if (!nums.length) return null;
  return Math.round(nums.reduce((s, n) => s + n, 0) / nums.length);
}

function pct(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.round((part / whole) * 1000) / 10;
}

const LIVE_TOPUP_WHERE: Prisma.LedgerEntryWhereInput = {
  amount: { gt: 0 },
  reason: { contains: "topup" },
  AND: [
    { NOT: { reason: { contains: "stub" } } },
    { NOT: { reason: { contains: "preview" } } },
  ],
};

export async function getSalesDateBounds(): Promise<{
  minSignupYmd: string | null;
  maxYmd: string;
}> {
  const minUser = await prisma.user.findFirst({
    where: { source: "telegram" },
    orderBy: { createdAt: "asc" },
    select: { createdAt: true },
  });
  return {
    minSignupYmd: minUser ? mskYmd(minUser.createdAt) : null,
    maxYmd: mskYmd(),
  };
}

export async function collectSalesAnalytics(
  params: SalesAnalyticsParams,
): Promise<SalesAnalyticsResult> {
  const bounds = await getSalesDateBounds();
  const maxYmd = bounds.maxYmd;
  const minYmd = bounds.minSignupYmd || maxYmd;

  let fromYmd = isValidYmd(params.fromYmd) ? params.fromYmd : maxYmd;
  let toYmd = isValidYmd(params.toYmd) ? params.toYmd : maxYmd;
  if (fromYmd < minYmd) fromYmd = minYmd;
  if (toYmd > maxYmd) toYmd = maxYmd;
  if (toYmd < fromYmd) toYmd = fromYmd;

  const from = mskDayStartUtc(fromYmd);
  const toExclusive = mskDayStartUtc(addYmdDays(toYmd, 1));
  const grain: SalesGrain =
    params.grain === "week" || params.grain === "day"
      ? params.grain
      : daySpan(fromYmd, toYmd) > 14
        ? "week"
        : "day";
  const currency: SalesCurrency =
    params.currency === "peaches" || params.currency === "both"
      ? params.currency
      : "rub";

  const cohortUsers = await prisma.user.findMany({
    where: {
      source: "telegram",
      createdAt: { gte: from, lt: toExclusive },
    },
    select: { id: true, createdAt: true },
  });
  const cohortIds = cohortUsers.map((u) => u.id);
  const createdById = new Map(cohortUsers.map((u) => [u.id, u.createdAt]));
  const N = cohortIds.length;

  const eventKeys = SALES_FUNNEL_STEPS.filter((s) => s.kind === "event").map(
    (s) => s.eventKey!,
  );

  const [eventHits, paidOrders, cashOrders, cashLedger] = await Promise.all([
    N
      ? prisma.funnelEvent.findMany({
          where: {
            userId: { in: cohortIds },
            eventKey: { in: eventKeys },
          },
          select: { userId: true, eventKey: true },
          distinct: ["userId", "eventKey"],
        })
      : Promise.resolve([] as { userId: string; eventKey: string }[]),
    N
      ? prisma.paymentOrder.findMany({
          where: {
            userId: { in: cohortIds },
            status: "paid",
            paidAt: { not: null },
          },
          select: {
            userId: true,
            paidAt: true,
            amountMinor: true,
            peaches: true,
          },
          orderBy: { paidAt: "asc" },
        })
      : Promise.resolve(
          [] as {
            userId: string;
            paidAt: Date | null;
            amountMinor: number;
            peaches: number;
          }[],
        ),
    prisma.paymentOrder.findMany({
      where: {
        status: "paid",
        paidAt: { gte: from, lt: toExclusive },
      },
      select: {
        userId: true,
        paidAt: true,
        amountMinor: true,
        peaches: true,
        paymentMethod: true,
      },
    }),
    prisma.ledgerEntry.findMany({
      where: {
        ...LIVE_TOPUP_WHERE,
        createdAt: { gte: from, lt: toExclusive },
      },
      select: { userId: true, amount: true, createdAt: true },
    }),
  ]);

  const usersByEvent = new Map<string, Set<string>>();
  for (const h of eventHits) {
    let set = usersByEvent.get(h.eventKey);
    if (!set) {
      set = new Set();
      usersByEvent.set(h.eventKey, set);
    }
    set.add(h.userId);
  }

  const firstPayByUser = new Map<string, Date>();
  let cohortRubMinor = 0;
  let cohortPeachesFromOrders = 0;
  let paymentsCount = 0;
  for (const o of paidOrders) {
    if (!o.paidAt) continue;
    paymentsCount += 1;
    cohortRubMinor += o.amountMinor;
    cohortPeachesFromOrders += o.peaches;
    const prev = firstPayByUser.get(o.userId);
    if (!prev || o.paidAt < prev) firstPayByUser.set(o.userId, o.paidAt);
  }

  // Cohort peaches via live ledger (боевые topup, не stub/preview)
  let cohortPeachesTotal = cohortPeachesFromOrders;
  if (N) {
    const ledgerCohort = await prisma.ledgerEntry.aggregate({
      where: {
        ...LIVE_TOPUP_WHERE,
        userId: { in: cohortIds },
      },
      _sum: { amount: true },
    });
    cohortPeachesTotal = ledgerCohort._sum?.amount || cohortPeachesFromOrders;
  }

  const payers = firstPayByUser.size;
  const msToFirst: number[] = [];
  let payersWithin7d = 0;
  const sevenMs = 7 * 86_400_000;
  for (const [uid, paidAt] of firstPayByUser) {
    const created = createdById.get(uid);
    if (!created) continue;
    const ms = paidAt.getTime() - created.getTime();
    if (ms >= 0) msToFirst.push(ms);
    if (ms >= 0 && ms <= sevenMs) payersWithin7d += 1;
  }

  const funnel: FunnelStepRow[] = [];
  let prevUniques = N;
  for (const step of SALES_FUNNEL_STEPS) {
    let uniqueUsers = 0;
    if (step.kind === "cohort") uniqueUsers = N;
    else if (step.kind === "event") {
      uniqueUsers = usersByEvent.get(step.eventKey!)?.size || 0;
    } else {
      uniqueUsers = payers;
    }
    const row: FunnelStepRow = {
      key: step.key,
      title: step.title,
      uniqueUsers,
      pctOfStart: pct(uniqueUsers, N),
      pctOfPrev: pct(uniqueUsers, prevUniques),
    };
    if (step.kind === "paid") {
      row.uniqueWithin7d = payersWithin7d;
      row.pctWithin7dOfStart = pct(payersWithin7d, N);
    }
    funnel.push(row);
    prevUniques = uniqueUsers;
  }

  // Cash widget (paidAt / ledger createdAt in window — not cohort)
  const cashMethodMap = new Map<
    string,
    { count: number; rubMinor: number; peaches: number }
  >();
  let cashRubMinor = 0;
  const rubPayerSet = new Set<string>();
  for (const o of cashOrders) {
    cashRubMinor += o.amountMinor;
    rubPayerSet.add(o.userId);
    const m = o.paymentMethod || "other";
    const cur = cashMethodMap.get(m) || { count: 0, rubMinor: 0, peaches: 0 };
    cur.count += 1;
    cur.rubMinor += o.amountMinor;
    cur.peaches += o.peaches;
    cashMethodMap.set(m, cur);
  }
  const cashPeaches = cashLedger.reduce((s, r) => s + r.amount, 0);
  const peachPayerSet = new Set(cashLedger.map((r) => r.userId));

  // Dynamics series
  const buckets = buildBuckets(fromYmd, toYmd, grain);
  const regByBucket = new Map<string, number>();
  const cohortPaidByBucket = new Map<string, number>();
  for (const b of buckets) {
    regByBucket.set(b.key, 0);
    cohortPaidByBucket.set(b.key, 0);
  }
  for (const u of cohortUsers) {
    const key = bucketKeyForInstant(u.createdAt, grain, fromYmd);
    if (!key || !regByBucket.has(key)) continue;
    regByBucket.set(key, (regByBucket.get(key) || 0) + 1);
    if (firstPayByUser.has(u.id)) {
      cohortPaidByBucket.set(key, (cohortPaidByBucket.get(key) || 0) + 1);
    }
  }

  const cashRubByBucket = new Map<string, number>();
  const cashPeachesByBucket = new Map<string, number>();
  const cashPayByBucket = new Map<string, number>();
  for (const b of buckets) {
    cashRubByBucket.set(b.key, 0);
    cashPeachesByBucket.set(b.key, 0);
    cashPayByBucket.set(b.key, 0);
  }
  for (const o of cashOrders) {
    if (!o.paidAt) continue;
    const key = bucketKeyForInstant(o.paidAt, grain, fromYmd);
    if (!key || !cashRubByBucket.has(key)) continue;
    cashRubByBucket.set(key, (cashRubByBucket.get(key) || 0) + o.amountMinor / 100);
    cashPayByBucket.set(key, (cashPayByBucket.get(key) || 0) + 1);
  }
  for (const r of cashLedger) {
    const key = bucketKeyForInstant(r.createdAt, grain, fromYmd);
    if (!key || !cashPeachesByBucket.has(key)) continue;
    cashPeachesByBucket.set(
      key,
      (cashPeachesByBucket.get(key) || 0) + r.amount,
    );
  }

  const revenuePerRegRub = N ? cohortRubMinor / 100 / N : 0;
  const revenuePerRegPeaches = N ? cohortPeachesTotal / N : 0;
  const paymentsPerReg = N ? paymentsCount / N : 0;

  return {
    meta: {
      fromYmd,
      toYmd,
      fromIso: from.toISOString(),
      toIsoExclusive: toExclusive.toISOString(),
      currency,
      grain,
      minSignupYmd: bounds.minSignupYmd,
      maxYmd,
      note:
        "Первичные регистрации = аккаунты, созданные в выбранные даты. Их шаги и оплаты — на момент отчёта (могли оплатить позже). Касса ниже — все оплаты, прошедшие в эти даты, в т.ч. от более ранних регистраций.",
    },
    kpi: {
      newUsers: N,
      paymentsCount,
      avgMsToFirstPay: mean(msToFirst),
      medianMsToFirstPay: median(msToFirst),
      revenuePerRegRub: round2(revenuePerRegRub),
      revenuePerRegPeaches: round2(revenuePerRegPeaches),
      paymentsPerReg: round2(paymentsPerReg),
      payers,
      payersWithin7d,
    },
    cash: {
      note:
        "Сколько денег реально зашло в выбранные даты (по времени оплаты). Это не срез по первичным регистрациям.",
      rubMinor: cashRubMinor,
      rub: round2(cashRubMinor / 100),
      peaches: cashPeaches,
      paymentsCount: cashOrders.length,
      rubPayers: rubPayerSet.size,
      peachPayers: peachPayerSet.size,
      methods: [...cashMethodMap.entries()]
        .map(([method, v]) => ({ method, ...v }))
        .sort((a, b) => b.count - a.count),
    },
    funnel,
    series: {
      grain,
      buckets: buckets.map((b) => ({
        key: b.key,
        label: b.label,
        fromYmd: b.fromYmd,
        toYmd: b.toYmd,
        registrations: regByBucket.get(b.key) || 0,
        cohortPaid: cohortPaidByBucket.get(b.key) || 0,
        cashRub: round2(cashRubByBucket.get(b.key) || 0),
        cashPeaches: cashPeachesByBucket.get(b.key) || 0,
        cashPayments: cashPayByBucket.get(b.key) || 0,
      })),
    },
  };
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function daySpan(fromYmd: string, toYmd: string): number {
  const a = mskDayStartUtc(fromYmd).getTime();
  const b = mskDayStartUtc(toYmd).getTime();
  return Math.floor((b - a) / 86_400_000) + 1;
}

function buildBuckets(fromYmd: string, toYmd: string, grain: SalesGrain) {
  const out: { key: string; label: string; fromYmd: string; toYmd: string }[] =
    [];
  if (grain === "day") {
    let cur = fromYmd;
    while (cur <= toYmd) {
      out.push({ key: cur, label: cur.slice(5), fromYmd: cur, toYmd: cur });
      cur = addYmdDays(cur, 1);
    }
    return out;
  }
  let mon = mskWeekMonday(fromYmd);
  while (mon <= toYmd) {
    const sun = addYmdDays(mon, 6);
    const bucketFrom = mon < fromYmd ? fromYmd : mon;
    const bucketTo = sun > toYmd ? toYmd : sun;
    out.push({
      key: mon,
      label: weekLabel(mon),
      fromYmd: bucketFrom,
      toYmd: bucketTo,
    });
    mon = addYmdDays(mon, 7);
  }
  return out;
}

function bucketKeyForInstant(
  at: Date,
  grain: SalesGrain,
  rangeFromYmd: string,
): string | null {
  const ymd = mskYmd(at);
  if (grain === "day") return ymd;
  const mon = mskWeekMonday(ymd);
  // Only count if Monday key is within built buckets (week overlapping range)
  const rangeMon = mskWeekMonday(rangeFromYmd);
  if (mon < rangeMon && ymd < rangeFromYmd) return null;
  return mon;
}
