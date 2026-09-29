/**
 * OPS sales analytics: cohort-by-signup funnel + cash-by-paidAt widget.
 * Dates are Europe/Moscow calendar days.
 */
import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";

const MSK = "Europe/Moscow";
const MSK_OFFSET_MS = 3 * 3600_000;

export type SalesCurrency = "rub" | "peaches" | "both";
export type SalesGrain = "day" | "week" | "period";

export type SalesFunnelStepDef = {
  key: string;
  title: string;
  /** Named eventKey(s); null for synthetic cohort/paid/repeat */
  eventKeys: string[] | null;
  /** Legacy match in metaJson (fv2 callbacks before catalog keys) */
  metaContains?: string[];
  kind: "event" | "paid" | "repeat_paid";
};

/** Funnel v2 steps (named keys + legacy meta.callback fallback). */
export const SALES_FUNNEL_STEPS: SalesFunnelStepDef[] = [
  {
    key: "bot.start",
    title: "Вход в воронку",
    eventKeys: ["bot.start", "bot.start.returning"],
    kind: "event",
  },
  {
    key: "bot.fv2.rules",
    title: "Согласился с правилами",
    eventKeys: ["bot.fv2.rules"],
    metaContains: ["fv2:rules"],
    kind: "event",
  },
  {
    key: "bot.fv2.hub",
    title: "Главное меню",
    eventKeys: ["bot.fv2.hub"],
    metaContains: ["fv2:hub"],
    kind: "event",
  },
  {
    key: "bot.fv2.photo",
    title: "Раздел фото",
    eventKeys: ["bot.fv2.photo"],
    metaContains: ["fv2:ph"],
    kind: "event",
  },
  {
    key: "bot.fv2.video",
    title: "Раздел видео",
    eventKeys: ["bot.fv2.video"],
    metaContains: ["fv2:vid"],
    kind: "event",
  },
  {
    key: "bot.fv2.topup",
    title: "Открыл пополнение",
    eventKeys: ["bot.fv2.topup"],
    metaContains: ["fv2:tu"],
    kind: "event",
  },
  { key: "paid", title: "Сделал первую оплату", eventKeys: null, kind: "paid" },
  {
    key: "repeat_paid",
    title: "Сделал повторную оплату",
    eventKeys: null,
    kind: "repeat_paid",
  },
];

/** @deprecated alias */
export const SALES_FUNNEL_V2_STEPS = SALES_FUNNEL_STEPS;

export type SalesPartnerOption = {
  id: string;
  code: string;
  name: string | null;
  tgId: string | null;
};

export type SalesAnalyticsParams = {
  fromYmd: string;
  toYmd: string;
  currency: SalesCurrency;
  grain: SalesGrain;
  cashGrain: SalesGrain;
  /**
   * PartnerProfile ids to include.
   * omit / undefined = все (без фильтра).
   * [] = никто (пустая когорта).
   * partial = только эти партнёры.
   */
  partnerIds?: string[] | null;
};

export type FunnelStepRow = {
  key: string;
  title: string;
  uniqueUsers: number;
  pctOfStart: number;
  pctOfPrev: number;
  uniqueWithin7d?: number;
  pctWithin7dOfStart?: number;
};

export type CashMethodSlice = {
  method: string;
  count: number;
  rubMinor: number;
  peaches: number;
};

export type SalesAnalyticsResult = {
  meta: {
    fromYmd: string;
    toYmd: string;
    fromIso: string;
    toIsoExclusive: string;
    currency: SalesCurrency;
    grain: SalesGrain;
    cashGrain: SalesGrain;
    minSignupYmd: string | null;
    maxYmd: string;
    partnerIds: string[] | "all" | "none";
    note: string;
  };
  partners: SalesPartnerOption[];
  kpi: {
    newUsers: number;
    paymentsCount: number;
    revenueSumRub: number;
    revenueSumPeaches: number;
    avgMsToFirstPay: number | null;
    medianMsToFirstPay: number | null;
    revenuePerRegRub: number;
    revenuePerRegPeaches: number;
    paymentsPerReg: number;
    payers: number;
    payersWithin7d: number;
  };
  cash: {
    note: string;
    rubMinor: number;
    rub: number;
    peaches: number;
    paymentsCount: number;
    rubPayers: number;
    peachPayers: number;
    methods: CashMethodSlice[];
    series: {
      grain: SalesGrain;
      buckets: {
        key: string;
        label: string;
        fromYmd: string;
        toYmd: string;
        title: string;
        total: number;
        byMethod: { method: string; count: number }[];
      }[];
    };
  };
  funnels: FunnelStepRow[];
  series: {
    grain: SalesGrain;
    buckets: {
      key: string;
      label: string;
      fromYmd: string;
      toYmd: string;
      title: string;
      registrations: number;
      cohortPaid: number;
      /** Cohort regs in bucket with strictly >1 paid orders */
      repeatPayers: number;
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

function mskWeekMonday(ymd: string): string {
  const start = mskDayStartUtc(ymd);
  const shifted = new Date(start.getTime() + MSK_OFFSET_MS);
  const dow = shifted.getUTCDay();
  const mondayOffset = dow === 0 ? -6 : 1 - dow;
  return addYmdDays(ymd, mondayOffset);
}

/** Compact axis label: 29.09 or 21–29.09 (same month) or 28.09–04.10 */
function bucketRangeLabel(fromYmd: string, toYmd: string): string {
  const d = (ymd: string) => {
    const mo = ymd.slice(5, 7);
    const day = ymd.slice(8, 10);
    return `${day}.${mo}`;
  };
  if (fromYmd === toYmd) return d(fromYmd);
  const sameMonth = fromYmd.slice(0, 7) === toYmd.slice(0, 7);
  if (sameMonth) return `${fromYmd.slice(8, 10)}–${d(toYmd)}`;
  return `${d(fromYmd)}–${d(toYmd)}`;
}

function bucketFullTitle(fromYmd: string, toYmd: string): string {
  if (fromYmd === toYmd) return fromYmd;
  return `${fromYmd} – ${toYmd}`;
}

function parseGrainParam(raw: SalesGrain | undefined, fallback: SalesGrain): SalesGrain {
  if (raw === "day" || raw === "week" || raw === "period") return raw;
  return fallback;
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

const LIVE_TOPUP_BASE: Prisma.LedgerEntryWhereInput = {
  amount: { gt: 0 },
  reason: { contains: "topup" },
};

function isLiveTopupReason(reason: string) {
  const r = reason.toLowerCase();
  return r.includes("topup") && !r.includes("stub") && !r.includes("preview");
}

/** SQLite + Prisma: large `in` + NOT/`not` can't auto-split — chunk ourselves. */
const IN_CHUNK = 200;

function chunkIds(ids: string[], size = IN_CHUNK): string[][] {
  if (!ids.length) return [];
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i += size) {
    out.push(ids.slice(i, i + size));
  }
  return out;
}

async function mapChunks<T>(
  ids: string[],
  fn: (chunk: string[]) => Promise<T[]>,
): Promise<T[]> {
  const parts = await Promise.all(chunkIds(ids).map(fn));
  return parts.flat();
}

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

function collectEventKeys(steps: SalesFunnelStepDef[]): string[] {
  const keys = new Set<string>();
  for (const s of steps) {
    if (s.eventKeys) for (const k of s.eventKeys) keys.add(k);
  }
  return [...keys];
}

function buildFunnelRows(
  steps: SalesFunnelStepDef[],
  payers: number,
  repeatPayers: number,
  payersWithin7d: number,
  usersByStepKey: Map<string, Set<string>>,
): FunnelStepRow[] {
  const counts: number[] = [];
  for (const step of steps) {
    if (step.kind === "paid") counts.push(payers);
    else if (step.kind === "repeat_paid") counts.push(repeatPayers);
    else counts.push(usersByStepKey.get(step.key)?.size || 0);
  }
  const base = counts[0] || 0;
  const funnel: FunnelStepRow[] = [];
  let prevUniques = base;
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]!;
    const uniqueUsers = counts[i]!;
    const row: FunnelStepRow = {
      key: step.key,
      title: step.title,
      uniqueUsers,
      pctOfStart: pct(uniqueUsers, base),
      pctOfPrev: i === 0 ? 100 : pct(uniqueUsers, prevUniques),
    };
    if (step.kind === "paid") {
      row.uniqueWithin7d = payersWithin7d;
      row.pctWithin7dOfStart = pct(payersWithin7d, base);
    }
    funnel.push(row);
    prevUniques = uniqueUsers;
  }
  return funnel;
}

export async function listSalesPartners(): Promise<SalesPartnerOption[]> {
  const rows = await prisma.partnerProfile.findMany({
    orderBy: [{ status: "asc" }, { code: "asc" }],
    select: {
      id: true,
      code: true,
      user: {
        select: {
          name: true,
          platformAccounts: {
            where: { platform: "telegram" },
            select: { platformUserId: true },
            take: 1,
            orderBy: { lastSeenAt: "desc" },
          },
        },
      },
    },
  });
  return rows.map((p) => ({
    id: p.id,
    code: p.code,
    name: p.user.name,
    tgId: p.user.platformAccounts[0]?.platformUserId ?? null,
  }));
}

export async function collectSalesAnalytics(
  params: SalesAnalyticsParams,
): Promise<SalesAnalyticsResult> {
  const bounds = await getSalesDateBounds();
  const maxYmd = bounds.maxYmd;
  const minYmd = bounds.minSignupYmd || maxYmd;
  const partners = await listSalesPartners();
  const knownPartnerIds = new Set(partners.map((p) => p.id));

  let fromYmd = isValidYmd(params.fromYmd) ? params.fromYmd : maxYmd;
  let toYmd = isValidYmd(params.toYmd) ? params.toYmd : maxYmd;
  if (fromYmd < minYmd) fromYmd = minYmd;
  if (toYmd > maxYmd) toYmd = maxYmd;
  if (toYmd < fromYmd) toYmd = fromYmd;

  const from = mskDayStartUtc(fromYmd);
  const toExclusive = mskDayStartUtc(addYmdDays(toYmd, 1));
  const defaultGrain: SalesGrain = daySpan(fromYmd, toYmd) > 14 ? "week" : "day";
  const grain: SalesGrain = parseGrainParam(params.grain, defaultGrain);
  const cashGrain: SalesGrain = parseGrainParam(params.cashGrain, defaultGrain);
  const currency: SalesCurrency =
    params.currency === "peaches" || params.currency === "both"
      ? params.currency
      : "rub";

  const partnersNone =
    params.partnerIds != null && params.partnerIds.length === 0;
  const rawPartnerIds = (params.partnerIds || []).filter((id) =>
    knownPartnerIds.has(id),
  );
  const partnerFilterActive =
    !partnersNone &&
    rawPartnerIds.length > 0 &&
    rawPartnerIds.length < knownPartnerIds.size;
  const partnerIds = partnerFilterActive ? rawPartnerIds : [];
  const partnerMeta: string[] | "all" | "none" = partnersNone
    ? "none"
    : partnerFilterActive
      ? partnerIds
      : "all";

  const cohortWhere: Prisma.UserWhereInput = partnersNone
    ? { id: { in: [] } }
    : {
        source: "telegram",
        createdAt: { gte: from, lt: toExclusive },
        ...(partnerFilterActive
          ? { partnerAttribution: { partnerId: { in: partnerIds } } }
          : {}),
      };

  const cashUserFilter: Prisma.PaymentOrderWhereInput = partnersNone
    ? { id: { in: [] } }
    : partnerFilterActive
      ? { user: { partnerAttribution: { partnerId: { in: partnerIds } } } }
      : {};
  const cashLedgerUserFilter: Prisma.LedgerEntryWhereInput = partnersNone
    ? { id: { in: [] } }
    : partnerFilterActive
      ? { user: { partnerAttribution: { partnerId: { in: partnerIds } } } }
      : {};

  const cohortUsers = await prisma.user.findMany({
    where: cohortWhere,
    select: { id: true, createdAt: true },
  });
  const cohortIds = cohortUsers.map((u) => u.id);
  const createdById = new Map(cohortUsers.map((u) => [u.id, u.createdAt]));
  const N = cohortIds.length;

  const allEventKeys = collectEventKeys(SALES_FUNNEL_STEPS);

  const [eventHits, fv2LegacyHits, paidOrdersRaw, cashOrders, cashLedgerRaw] =
    await Promise.all([
      N
        ? mapChunks(cohortIds, (chunk) =>
            prisma.funnelEvent.findMany({
              where: {
                userId: { in: chunk },
                eventKey: { in: allEventKeys },
              },
              select: { userId: true, eventKey: true, metaJson: true },
              distinct: ["userId", "eventKey"],
            }),
          )
        : Promise.resolve(
            [] as { userId: string; eventKey: string; metaJson: string }[],
          ),
      N
        ? mapChunks(cohortIds, (chunk) =>
            prisma.funnelEvent.findMany({
              where: {
                userId: { in: chunk },
                eventKey: "bot.callback.other",
                metaJson: { contains: "fv2:" },
              },
              select: { userId: true, metaJson: true },
            }),
          )
        : Promise.resolve([] as { userId: string; metaJson: string }[]),
      N
        ? mapChunks(cohortIds, (chunk) =>
            prisma.paymentOrder.findMany({
              where: {
                userId: { in: chunk },
                status: "paid",
              },
              select: {
                userId: true,
                paidAt: true,
                amountMinor: true,
                peaches: true,
              },
              orderBy: { paidAt: "asc" },
            }),
          )
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
          ...cashUserFilter,
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
          ...LIVE_TOPUP_BASE,
          createdAt: { gte: from, lt: toExclusive },
          ...cashLedgerUserFilter,
        },
        select: { userId: true, amount: true, createdAt: true, reason: true },
      }),
    ]);

  const paidOrders = paidOrdersRaw.filter((o) => o.paidAt != null);
  const cashLedger = cashLedgerRaw.filter((r) => isLiveTopupReason(r.reason));

  const payCountByUser = new Map<string, number>();
  const firstPayByUser = new Map<string, Date>();
  let cohortRubMinor = 0;
  let cohortPeachesFromOrders = 0;
  let paymentsCount = 0;
  for (const o of paidOrders) {
    if (!o.paidAt) continue;
    paymentsCount += 1;
    cohortRubMinor += o.amountMinor;
    cohortPeachesFromOrders += o.peaches;
    payCountByUser.set(o.userId, (payCountByUser.get(o.userId) || 0) + 1);
    const prev = firstPayByUser.get(o.userId);
    if (!prev || o.paidAt < prev) firstPayByUser.set(o.userId, o.paidAt);
  }

  let cohortPeachesTotal = cohortPeachesFromOrders;
  if (N) {
    const ledgerRows = await mapChunks(cohortIds, (chunk) =>
      prisma.ledgerEntry.findMany({
        where: {
          ...LIVE_TOPUP_BASE,
          userId: { in: chunk },
        },
        select: { amount: true, reason: true },
      }),
    );
    cohortPeachesTotal = ledgerRows
      .filter((r) => isLiveTopupReason(r.reason))
      .reduce((s, r) => s + r.amount, 0);
    if (!cohortPeachesTotal) cohortPeachesTotal = cohortPeachesFromOrders;
  }

  const payers = firstPayByUser.size;
  let repeatPayers = 0;
  for (const count of payCountByUser.values()) {
    if (count > 1) repeatPayers += 1;
  }
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

  function usersForSteps(steps: SalesFunnelStepDef[]): Map<string, Set<string>> {
    const byStep = new Map<string, Set<string>>();
    for (const step of steps) {
      if (step.kind !== "event") continue;
      byStep.set(step.key, new Set());
    }
    for (const h of eventHits) {
      for (const step of steps) {
        if (step.kind !== "event" || !step.eventKeys) continue;
        if (step.eventKeys.includes(h.eventKey)) {
          byStep.get(step.key)!.add(h.userId);
        }
      }
    }
    for (const h of fv2LegacyHits) {
      const meta = h.metaJson || "";
      for (const step of steps) {
        if (step.kind !== "event" || !step.metaContains) continue;
        if (step.metaContains.some((needle) => meta.includes(needle))) {
          byStep.get(step.key)!.add(h.userId);
        }
      }
    }
    return byStep;
  }

  const funnel = buildFunnelRows(
    SALES_FUNNEL_STEPS,
    payers,
    repeatPayers,
    payersWithin7d,
    usersForSteps(SALES_FUNNEL_STEPS),
  );

  // Cash totals
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

  // Cash series by cashGrain + method
  const cashBuckets = buildBuckets(fromYmd, toYmd, cashGrain);
  const cashSeriesMap = new Map<string, Map<string, number>>();
  for (const b of cashBuckets) cashSeriesMap.set(b.key, new Map());
  for (const o of cashOrders) {
    if (!o.paidAt) continue;
    const key = bucketKeyForInstant(o.paidAt, cashGrain, cashBuckets, fromYmd, toYmd);
    if (!key || !cashSeriesMap.has(key)) continue;
    const method = o.paymentMethod || "other";
    const m = cashSeriesMap.get(key)!;
    m.set(method, (m.get(method) || 0) + 1);
  }

  // Dynamics (registration grain)
  const buckets = buildBuckets(fromYmd, toYmd, grain);
  const regByBucket = new Map<string, number>();
  const cohortPaidByBucket = new Map<string, number>();
  const repeatByBucket = new Map<string, number>();
  for (const b of buckets) {
    regByBucket.set(b.key, 0);
    cohortPaidByBucket.set(b.key, 0);
    repeatByBucket.set(b.key, 0);
  }
  for (const u of cohortUsers) {
    const key = bucketKeyForInstant(u.createdAt, grain, buckets, fromYmd, toYmd);
    if (!key || !regByBucket.has(key)) continue;
    regByBucket.set(key, (regByBucket.get(key) || 0) + 1);
    const pays = payCountByUser.get(u.id) || 0;
    if (pays >= 1) {
      cohortPaidByBucket.set(key, (cohortPaidByBucket.get(key) || 0) + 1);
    }
    if (pays > 1) {
      repeatByBucket.set(key, (repeatByBucket.get(key) || 0) + 1);
    }
  }

  const revenueSumRub = round2(cohortRubMinor / 100);
  const revenuePerRegRub = N ? revenueSumRub / N : 0;
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
      cashGrain,
      minSignupYmd: bounds.minSignupYmd,
      maxYmd,
      partnerIds: partnerMeta,
      note:
        "Первичные регистрации = аккаунты, созданные в выбранные даты. Их шаги и оплаты — на момент отчёта (могли оплатить позже). Касса ниже — все оплаты, прошедшие в эти даты, в т.ч. от более ранних регистраций.",
    },
    partners,
    kpi: {
      newUsers: N,
      paymentsCount,
      revenueSumRub,
      revenueSumPeaches: cohortPeachesTotal,
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
      series: {
        grain: cashGrain,
        buckets: cashBuckets.map((b) => {
          const methods = cashSeriesMap.get(b.key) || new Map();
          const byMethod = [...methods.entries()]
            .map(([method, count]) => ({ method, count }))
            .sort((a, b) => b.count - a.count);
          return {
            key: b.key,
            label: b.label,
            fromYmd: b.fromYmd,
            toYmd: b.toYmd,
            title: bucketFullTitle(b.fromYmd, b.toYmd),
            total: byMethod.reduce((s, x) => s + x.count, 0),
            byMethod,
          };
        }),
      },
    },
    funnels: funnel,
    series: {
      grain,
      buckets: buckets.map((b) => ({
        key: b.key,
        label: b.label,
        fromYmd: b.fromYmd,
        toYmd: b.toYmd,
        title: bucketFullTitle(b.fromYmd, b.toYmd),
        registrations: regByBucket.get(b.key) || 0,
        cohortPaid: cohortPaidByBucket.get(b.key) || 0,
        repeatPayers: repeatByBucket.get(b.key) || 0,
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
  if (grain === "period") {
    out.push({
      key: "period",
      label: bucketRangeLabel(fromYmd, toYmd),
      fromYmd,
      toYmd,
    });
    return out;
  }
  if (grain === "day") {
    let cur = fromYmd;
    while (cur <= toYmd) {
      out.push({
        key: cur,
        label: bucketRangeLabel(cur, cur),
        fromYmd: cur,
        toYmd: cur,
      });
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
      key: `${bucketFrom}_${bucketTo}`,
      label: bucketRangeLabel(bucketFrom, bucketTo),
      fromYmd: bucketFrom,
      toYmd: bucketTo,
    });
    mon = addYmdDays(mon, 7);
  }
  return out;
}

function bucketKeyForYmd(
  ymd: string,
  grain: SalesGrain,
  buckets: { key: string; fromYmd: string; toYmd: string }[],
  rangeFromYmd: string,
  rangeToYmd: string,
): string | null {
  if (ymd < rangeFromYmd || ymd > rangeToYmd) return null;
  if (grain === "period") return buckets[0]?.key ?? null;
  if (grain === "day") {
    return buckets.some((b) => b.key === ymd) ? ymd : null;
  }
  for (const b of buckets) {
    if (ymd >= b.fromYmd && ymd <= b.toYmd) return b.key;
  }
  return null;
}

function bucketKeyForInstant(
  at: Date,
  grain: SalesGrain,
  buckets: { key: string; fromYmd: string; toYmd: string }[],
  rangeFromYmd: string,
  rangeToYmd: string,
): string | null {
  return bucketKeyForYmd(mskYmd(at), grain, buckets, rangeFromYmd, rangeToYmd);
}
