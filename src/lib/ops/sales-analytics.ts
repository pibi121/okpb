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
  kind: "cohort" | "event" | "paid" | "repeat_paid";
  /**
   * First-touch photo/video/pro among users who hit this step.
   * - section: earliest photo|video|pro section event
   * - generation: earliest bot.fv2.gen_start, kind from meta
   */
  firstTouch?: "section" | "generation";
};

export type FunnelTouchBreakdown = {
  photo: number;
  video: number;
  pro: number;
};

type TouchKind = keyof FunnelTouchBreakdown;

/** Основная воронка. */
export const SALES_FUNNEL_MAIN_STEPS: SalesFunnelStepDef[] = [
  // Регистрация = первый /start. База воронки = когорта KPI и «Динамики».
  {
    key: "registered",
    title: "Регистрация (/start)",
    eventKeys: null,
    kind: "cohort",
  },
  {
    key: "bot.fv2.rules",
    title: "Правила",
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
    key: "section",
    title: "Перешёл в раздел",
    eventKeys: ["bot.fv2.photo", "bot.fv2.video", "bot.fv2.pro"],
    metaContains: ["fv2:ph", "fv2:vid", "fv2:pro"],
    kind: "event",
    firstTouch: "section",
  },
  {
    key: "bot.fv2.gen_start",
    title: "Запустил генерацию",
    eventKeys: ["bot.fv2.gen_start"],
    kind: "event",
    firstTouch: "generation",
  },
  {
    key: "bot.fv2.topup",
    title: "Открыл пополнение",
    eventKeys: ["bot.fv2.topup", "bot.topup.open"],
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

/**
 * Основная воронка «по факту»: события в выбранных датах, дата регистрации не важна.
 * Первый шаг — все, кто нажал /start в эти даты (включая вернувшихся).
 */
export const SALES_FUNNEL_MAIN_FACT_STEPS: SalesFunnelStepDef[] = [
  {
    key: "registered",
    title: "Нажали /start за даты",
    eventKeys: ["bot.start", "bot.start.returning", "bot.start.photos_upload"],
    kind: "event",
  },
  ...SALES_FUNNEL_MAIN_STEPS.slice(1),
];

/**
 * Legacy faststart-срез (API only; UI не показывает).
 */
export const SALES_FUNNEL_TEST_STEPS: SalesFunnelStepDef[] = [
  { key: "registered", title: "Регистрация", eventKeys: null, kind: "cohort" },
  {
    key: "bot.fv2.rules",
    title: "Принятие правил",
    eventKeys: ["bot.fv2.rules"],
    metaContains: ["fv2:rules"],
    kind: "event",
  },
  {
    key: "bot.fv2.gen_start",
    title: "Запустил генерацию",
    eventKeys: ["bot.fv2.gen_start"],
    kind: "event",
  },
  {
    key: "bot.fv2.topup",
    title: "Перешёл к пополнению",
    eventKeys: ["bot.fv2.topup", "bot.topup.open"],
    metaContains: ["fv2:tu"],
    kind: "event",
  },
  { key: "paid", title: "Пополнил", eventKeys: null, kind: "paid" },
  {
    key: "repeat_paid",
    title: "Пополнил повторно",
    eventKeys: null,
    kind: "repeat_paid",
  },
];

/**
 * Воронка оплат (микроконверсия кассы):
 * открыл → сумма → способ → ссылка готова → оплатил.
 */
export const SALES_FUNNEL_PAY_STEPS: SalesFunnelStepDef[] = [
  {
    key: "bot.topup.open",
    title: "Открыл пополнение",
    eventKeys: ["bot.topup.open", "bot.fv2.topup"],
    metaContains: ['"callback":"fv2:tu"', "fv2:tu"],
    kind: "event",
  },
  {
    key: "bot.topup.amount",
    title: "Выбрал сумму",
    eventKeys: ["bot.topup.amount"],
    metaContains: ["fv2:tu:a:", "fv2:tu:ba:"],
    kind: "event",
  },
  {
    key: "bot.topup.method",
    title: "Выбрал способ оплаты",
    eventKeys: ["bot.topup.method"],
    metaContains: ["tu:pay:"],
    kind: "event",
  },
  {
    key: "bot.topup.order_created",
    title: "Получил ссылку на оплату",
    eventKeys: ["bot.topup.order_created"],
    kind: "event",
  },
  { key: "paid", title: "Оплатил", eventKeys: null, kind: "paid" },
];

/** @deprecated alias → main */
export const SALES_FUNNEL_STEPS = SALES_FUNNEL_MAIN_STEPS;
/** @deprecated alias */
export const SALES_FUNNEL_V2_STEPS = SALES_FUNNEL_MAIN_STEPS;

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
  /** First-touch photo/video/pro; photo+video+pro === uniqueUsers */
  breakdown?: FunnelTouchBreakdown;
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
    /** Telegram-аккаунты, созданные в окне, но без единого /start (не в когорте). */
    ghostUsers: number;
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
    /** Age-gate: заблокированные фото в выбранных датах (все юзеры, не только когорта). */
    ageBlockedAttempts: number;
    ageBlockedUsers: number;
    /** Отправлено на ручную проверку («Ей есть 18!») в выбранных датах. */
    ageAppeals: number;
    ageAppealUsers: number;
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
  /** Legacy API field (UI не показывает). */
  funnelsTest: FunnelStepRow[];
  /** Воронка оплат: open → amount → method → order → paid. */
  funnelsPay: FunnelStepRow[];
  /**
   * Воронка оплат «по факту»: шаги по времени события/оплаты в выбранных датах
   * (не когорта регистраций).
   */
  funnelsPayFact: FunnelStepRow[];
  /** Основная воронка «по факту»: события в датах, не когорта регистраций. */
  funnelsMainFact: FunnelStepRow[];
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

/** Blur pack buttons were stored as bot.topup.open with callback fv2:tu:ba:. */
function metaChoosesTopupAmount(stepKey: string, meta: string, needles?: string[]) {
  if (stepKey !== "bot.topup.amount" || !needles?.length) return false;
  return needles.some((needle) => meta.includes(needle));
}

const START_EVENT_KEYS = [
  "bot.start",
  "bot.start.returning",
  "bot.start.photos_upload",
];

type CohortWindowArgs = {
  from: Date;
  toExclusive: Date;
  partnersNone: boolean;
  partnerFilterActive: boolean;
  partnerIds: string[];
};

/**
 * Когорта регистраций = telegram-юзеры, чей ПЕРВЫЙ /start попал в окно.
 * regAt = время первого /start. Аккаунты без /start (спам-флуд) не входят.
 */
async function loadStartCohort(
  a: CohortWindowArgs,
): Promise<{ id: string; regAt: Date }[]> {
  if (a.partnersNone) return [];
  const groups = await prisma.funnelEvent.groupBy({
    by: ["userId"],
    where: {
      eventKey: { in: START_EVENT_KEYS },
      user: {
        source: "telegram",
        ...(a.partnerFilterActive
          ? { partnerAttribution: { partnerId: { in: a.partnerIds } } }
          : {}),
      },
    },
    _min: { at: true },
    having: { at: { _min: { gte: a.from, lt: a.toExclusive } } },
  });
  const out: { id: string; regAt: Date }[] = [];
  for (const g of groups) {
    const at = g._min.at;
    if (at) out.push({ id: g.userId, regAt: at });
  }
  return out;
}

/** Аккаунты, созданные в окне, но без ни одного /start. */
async function countGhostUsers(a: CohortWindowArgs): Promise<number> {
  if (a.partnersNone) return 0;
  return prisma.user.count({
    where: {
      source: "telegram",
      createdAt: { gte: a.from, lt: a.toExclusive },
      funnelEvents: { none: { eventKey: { in: START_EVENT_KEYS } } },
      ...(a.partnerFilterActive
        ? { partnerAttribution: { partnerId: { in: a.partnerIds } } }
        : {}),
    },
  });
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

function classifySectionTouch(
  eventKey: string,
  metaJson: string,
): TouchKind | null {
  if (eventKey === "bot.fv2.photo") return "photo";
  if (eventKey === "bot.fv2.video") return "video";
  if (eventKey === "bot.fv2.pro") return "pro";
  if (eventKey === "bot.callback.other") {
    const meta = metaJson || "";
    // More specific needles first (fv2:ph is a prefix of many photo callbacks).
    if (meta.includes("fv2:pro")) return "pro";
    if (meta.includes("fv2:vid")) return "video";
    if (meta.includes("fv2:ph")) return "photo";
  }
  return null;
}

/**
 * gen_start meta.kind today: photo path uses "ud" | "tpl".
 * Video does not yet emit gen_start; reserve qv/li2v/video → video.
 */
function classifyGenTouch(metaJson: string): TouchKind {
  try {
    const meta = JSON.parse(metaJson || "{}") as {
      kind?: unknown;
      section?: unknown;
    };
    const k = String(meta.kind ?? meta.section ?? "").toLowerCase();
    if (k === "video" || k === "qv" || k === "li2v" || k === "vid") {
      return "video";
    }
    if (k === "pro" || k === "lora") return "pro";
    return "photo";
  } catch {
    return "photo";
  }
}

function emptyBreakdown(): FunnelTouchBreakdown {
  return { photo: 0, video: 0, pro: 0 };
}

function computeFirstTouch(
  mode: "section" | "generation",
  eventHits: {
    userId: string;
    eventKey: string;
    metaJson: string;
    at: Date;
  }[],
  legacyHits: { userId: string; metaJson: string; at: Date }[],
): { users: Set<string>; breakdown: FunnelTouchBreakdown } {
  const earliest = new Map<string, { at: number; touch: TouchKind }>();

  const consider = (userId: string, at: Date, touch: TouchKind | null) => {
    if (!touch) return;
    const t = at.getTime();
    const prev = earliest.get(userId);
    if (!prev || t < prev.at) earliest.set(userId, { at: t, touch });
  };

  if (mode === "section") {
    for (const h of eventHits) {
      consider(h.userId, h.at, classifySectionTouch(h.eventKey, h.metaJson));
    }
    for (const h of legacyHits) {
      consider(
        h.userId,
        h.at,
        classifySectionTouch("bot.callback.other", h.metaJson),
      );
    }
  } else {
    for (const h of eventHits) {
      if (h.eventKey !== "bot.fv2.gen_start") continue;
      consider(h.userId, h.at, classifyGenTouch(h.metaJson));
    }
  }

  const breakdown = emptyBreakdown();
  for (const { touch } of earliest.values()) breakdown[touch] += 1;
  return { users: new Set(earliest.keys()), breakdown };
}

function buildFunnelRows(
  steps: SalesFunnelStepDef[],
  N: number,
  payers: number,
  repeatPayers: number,
  payersWithin7d: number,
  usersByStepKey: Map<string, Set<string>>,
  breakdownByStepKey?: Map<string, FunnelTouchBreakdown>,
): FunnelStepRow[] {
  const counts: number[] = [];
  for (const step of steps) {
    if (step.kind === "cohort") counts.push(N);
    else if (step.kind === "paid") counts.push(payers);
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
    const bd = breakdownByStepKey?.get(step.key);
    if (bd) row.breakdown = bd;
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

  // Регистрация = первое нажатие /start (FunnelEvent), не User.createdAt.
  const cohortUsers = (
    await loadStartCohort({
      from,
      toExclusive,
      partnersNone,
      partnerFilterActive,
      partnerIds,
    })
  ).map((m) => ({ id: m.id, createdAt: m.regAt }));
  const ghostUsers = await countGhostUsers({
    from,
    toExclusive,
    partnersNone,
    partnerFilterActive,
    partnerIds,
  });

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

  const cohortIds = cohortUsers.map((u) => u.id);
  const createdById = new Map(cohortUsers.map((u) => [u.id, u.createdAt]));
  const N = cohortIds.length;

  const allEventKeys = collectEventKeys([
    ...SALES_FUNNEL_MAIN_STEPS,
    ...SALES_FUNNEL_TEST_STEPS,
    ...SALES_FUNNEL_PAY_STEPS,
  ]);

  const [eventHits, fv2LegacyHits, paidOrdersRaw, cashOrders, cashLedgerRaw] =
    await Promise.all([
      N
        ? mapChunks(cohortIds, (chunk) =>
            prisma.funnelEvent.findMany({
              where: {
                userId: { in: chunk },
                eventKey: { in: allEventKeys },
              },
              select: {
                userId: true,
                eventKey: true,
                metaJson: true,
                at: true,
              },
              orderBy: { at: "asc" },
            }),
          )
        : Promise.resolve(
            [] as {
              userId: string;
              eventKey: string;
              metaJson: string;
              at: Date;
            }[],
          ),
      N
        ? mapChunks(cohortIds, (chunk) =>
            prisma.funnelEvent.findMany({
              where: {
                userId: { in: chunk },
                eventKey: "bot.callback.other",
                metaJson: { contains: "fv2:" },
              },
              select: { userId: true, metaJson: true, at: true },
              orderBy: { at: "asc" },
            }),
          )
        : Promise.resolve(
            [] as { userId: string; metaJson: string; at: Date }[],
          ),
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
      const meta = h.metaJson || "";
      for (const step of steps) {
        if (step.kind !== "event" || !step.eventKeys) continue;
        if (
          step.eventKeys.includes(h.eventKey) ||
          metaChoosesTopupAmount(step.key, meta, step.metaContains)
        ) {
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

  const usersByEvent = usersForSteps([
    ...SALES_FUNNEL_MAIN_STEPS,
    ...SALES_FUNNEL_TEST_STEPS,
    ...SALES_FUNNEL_PAY_STEPS,
  ]);

  // First-touch breakdowns for section / generation (override unique sets).
  const breakdownByStep = new Map<string, FunnelTouchBreakdown>();
  for (const step of SALES_FUNNEL_MAIN_STEPS) {
    if (!step.firstTouch) continue;
    const ft = computeFirstTouch(step.firstTouch, eventHits, fv2LegacyHits);
    usersByEvent.set(step.key, ft.users);
    breakdownByStep.set(step.key, ft.breakdown);
  }

  const funnel = buildFunnelRows(
    SALES_FUNNEL_MAIN_STEPS,
    N,
    payers,
    repeatPayers,
    payersWithin7d,
    usersByEvent,
    breakdownByStep,
  );
  const funnelTest = buildFunnelRows(
    SALES_FUNNEL_TEST_STEPS,
    N,
    payers,
    repeatPayers,
    payersWithin7d,
    usersByEvent,
  );
  const funnelPay = buildFunnelRows(
    SALES_FUNNEL_PAY_STEPS,
    N,
    payers,
    repeatPayers,
    payersWithin7d,
    usersByEvent,
  );

  // Pay funnel «по факту»: события и оплаты в окне дат (любая дата регистрации).
  const payFactEventKeys = collectEventKeys(SALES_FUNNEL_PAY_STEPS);
  const factEventUserFilter: Prisma.FunnelEventWhereInput = partnersNone
    ? { userId: { in: [] } }
    : partnerFilterActive
      ? { user: { partnerAttribution: { partnerId: { in: partnerIds } } } }
      : {};
  const [factEventHits, factLegacyHits] = await Promise.all([
    payFactEventKeys.length
      ? prisma.funnelEvent.findMany({
          where: {
            at: { gte: from, lt: toExclusive },
            eventKey: { in: payFactEventKeys },
            ...factEventUserFilter,
          },
          select: { userId: true, eventKey: true, metaJson: true },
          distinct: ["userId", "eventKey"],
        })
      : Promise.resolve(
          [] as { userId: string; eventKey: string; metaJson: string }[],
        ),
    prisma.funnelEvent.findMany({
      where: {
        at: { gte: from, lt: toExclusive },
        eventKey: "bot.callback.other",
        OR: [
          { metaJson: { contains: "fv2:tu" } },
          { metaJson: { contains: "tu:pay:" } },
        ],
        ...factEventUserFilter,
      },
      select: { userId: true, metaJson: true },
    }),
  ]);
  const factUsersByStep = new Map<string, Set<string>>();
  for (const step of SALES_FUNNEL_PAY_STEPS) {
    if (step.kind !== "event") continue;
    factUsersByStep.set(step.key, new Set());
  }
  for (const h of factEventHits) {
    const meta = h.metaJson || "";
    for (const step of SALES_FUNNEL_PAY_STEPS) {
      if (step.kind !== "event" || !step.eventKeys) continue;
      if (
        step.eventKeys.includes(h.eventKey) ||
        metaChoosesTopupAmount(step.key, meta, step.metaContains)
      ) {
        factUsersByStep.get(step.key)!.add(h.userId);
      }
    }
  }
  for (const h of factLegacyHits) {
    const meta = h.metaJson || "";
    for (const step of SALES_FUNNEL_PAY_STEPS) {
      if (step.kind !== "event" || !step.metaContains) continue;
      if (step.metaContains.some((needle) => meta.includes(needle))) {
        factUsersByStep.get(step.key)!.add(h.userId);
      }
    }
  }
  const ageBlockWhere: Prisma.FunnelEventWhereInput = {
    eventKey: "bot.agegate.block",
    at: { gte: from, lt: toExclusive },
    ...factEventUserFilter,
  };
  const [ageBlockedAttempts, ageBlockedUserRows] = await Promise.all([
    prisma.funnelEvent.count({ where: ageBlockWhere }),
    prisma.funnelEvent.findMany({
      where: ageBlockWhere,
      distinct: ["userId"],
      select: { userId: true },
    }),
  ]);
  const ageAppealWhere: Prisma.FunnelEventWhereInput = {
    ...ageBlockWhere,
    eventKey: "bot.agegate.appeal",
  };
  const [ageAppeals, ageAppealUserRows] = await Promise.all([
    prisma.funnelEvent.count({ where: ageAppealWhere }),
    prisma.funnelEvent.findMany({
      where: ageAppealWhere,
      distinct: ["userId"],
      select: { userId: true },
    }),
  ]);
  const factPayers = new Set(cashOrders.map((o) => o.userId)).size;
  const funnelPayFact = buildFunnelRows(
    SALES_FUNNEL_PAY_STEPS,
    0,
    factPayers,
    0,
    0,
    factUsersByStep,
  ).map((r) => {
    const { uniqueWithin7d: _a, pctWithin7dOfStart: _b, ...rest } = r;
    return rest;
  });
  const funnelMainFact = await buildFactFunnelRows(
    SALES_FUNNEL_MAIN_FACT_STEPS,
    { from, toExclusive, partnersNone, partnerFilterActive, partnerIds },
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
        "Регистрация = первое нажатие /start в выбранные даты. Аккаунты, созданные без /start (например, при спам-заходах), не считаются. Шаги и оплаты — на момент отчёта (могли оплатить позже). Касса ниже — все оплаты, прошедшие в эти даты, в т.ч. от более ранних регистраций.",
      ghostUsers,
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
      ageBlockedAttempts,
      ageBlockedUsers: ageBlockedUserRows.length,
      ageAppeals,
      ageAppealUsers: ageAppealUserRows.length,
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
    funnelsTest: funnelTest,
    funnelsPay: funnelPay,
    funnelsPayFact: funnelPayFact,
    funnelsMainFact: funnelMainFact,
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

const FUNNEL_USERS_LIMIT = 500;

export type FunnelStepUserRow = {
  userId: string;
  tgId: string;
  tgUsername: string | null;
  name: string | null;
  partnerCode: string | null;
  /** Имя пользователя-партнёра (User.name). */
  partnerName: string | null;
  /** TG @username партнёра. */
  partnerTgUsername: string | null;
  /** organic | partner:CODE | traffic:CODE */
  source: string;
  registeredAt: string;
};

export type FunnelKind = "main" | "pay";
/** cohort = по дате регистрации; fact = по факту событий в датах (только pay). */
export type FunnelBasis = "cohort" | "fact";
/** reached = дошли до шага; dropped = были на предыдущем шаге, но не дошли сюда. */
export type FunnelUsersView = "reached" | "dropped";

export type FunnelStepUsersResult = {
  funnel: FunnelKind;
  basis: FunnelBasis;
  view: FunnelUsersView;
  step: string;
  title: string;
  prevStep: string | null;
  prevTitle: string | null;
  fromYmd: string;
  toYmd: string;
  total: number;
  limit: number;
  users: FunnelStepUserRow[];
};

async function resolveSalesCohortWindow(params: {
  fromYmd: string;
  toYmd: string;
  partnerIds?: string[] | null;
}): Promise<{
  fromYmd: string;
  toYmd: string;
  from: Date;
  toExclusive: Date;
  partnersNone: boolean;
  partnerFilterActive: boolean;
  partnerIds: string[];
}> {
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

  return {
    fromYmd,
    toYmd,
    from,
    toExclusive,
    partnersNone,
    partnerFilterActive,
    partnerIds,
  };
}

function formatSalesSource(user: {
  trafficLink?: { code: string } | null;
  partnerAttribution?: { partner: { code: string } } | null;
}): string {
  if (user.trafficLink?.code) return `traffic:${user.trafficLink.code}`;
  if (user.partnerAttribution?.partner?.code) {
    return `partner:${user.partnerAttribution.partner.code}`;
  }
  return "organic";
}

type SalesCohortWindow = Awaited<ReturnType<typeof resolveSalesCohortWindow>>;

/** Кто дошёл до шага среди когорты регистраций (та же логика, что в воронке). */
async function cohortReachedSet(
  stepDef: SalesFunnelStepDef,
  cohortIds: string[],
): Promise<Set<string>> {
  const reached = new Set<string>();
  if (!cohortIds.length) return reached;

  if (stepDef.kind === "cohort") {
    for (const id of cohortIds) reached.add(id);
    return reached;
  }

  if (stepDef.kind === "paid" || stepDef.kind === "repeat_paid") {
    const orders = await mapChunks(cohortIds, (chunk) =>
      prisma.paymentOrder.findMany({
        where: { userId: { in: chunk }, status: "paid" },
        select: { userId: true },
      }),
    );
    const payCount = new Map<string, number>();
    for (const o of orders) {
      payCount.set(o.userId, (payCount.get(o.userId) || 0) + 1);
    }
    for (const [uid, n] of payCount) {
      if (stepDef.kind === "paid" && n >= 1) reached.add(uid);
      if (stepDef.kind === "repeat_paid" && n > 1) reached.add(uid);
    }
    return reached;
  }

  if (stepDef.firstTouch) {
    const keys = stepDef.eventKeys || [];
    const [eventHits, legacyHits] = await Promise.all([
      keys.length
        ? mapChunks(cohortIds, (chunk) =>
            prisma.funnelEvent.findMany({
              where: { userId: { in: chunk }, eventKey: { in: keys } },
              select: {
                userId: true,
                eventKey: true,
                metaJson: true,
                at: true,
              },
              orderBy: { at: "asc" },
            }),
          )
        : Promise.resolve(
            [] as {
              userId: string;
              eventKey: string;
              metaJson: string;
              at: Date;
            }[],
          ),
      stepDef.firstTouch === "section"
        ? mapChunks(cohortIds, (chunk) =>
            prisma.funnelEvent.findMany({
              where: {
                userId: { in: chunk },
                eventKey: "bot.callback.other",
                metaJson: { contains: "fv2:" },
              },
              select: { userId: true, metaJson: true, at: true },
              orderBy: { at: "asc" },
            }),
          )
        : Promise.resolve(
            [] as { userId: string; metaJson: string; at: Date }[],
          ),
    ]);
    return computeFirstTouch(stepDef.firstTouch, eventHits, legacyHits).users;
  }

  if (stepDef.eventKeys?.length) {
    const keys = stepDef.eventKeys;
    const [eventHits, legacyHits] = await Promise.all([
      mapChunks(cohortIds, (chunk) =>
        prisma.funnelEvent.findMany({
          where: { userId: { in: chunk }, eventKey: { in: keys } },
          select: { userId: true },
          distinct: ["userId"],
        }),
      ),
      stepDef.metaContains?.length
        ? mapChunks(cohortIds, (chunk) =>
            prisma.funnelEvent.findMany({
              where: {
                userId: { in: chunk },
                eventKey: "bot.callback.other",
                OR: stepDef.metaContains!.map((needle) => ({
                  metaJson: { contains: needle },
                })),
              },
              select: { userId: true },
              distinct: ["userId"],
            }),
          )
        : Promise.resolve([] as { userId: string }[]),
    ]);
    for (const h of eventHits) reached.add(h.userId);
    for (const h of legacyHits) reached.add(h.userId);
  }
  if (stepDef.key === "bot.topup.amount") {
    const blurHits = await mapChunks(cohortIds, (chunk) =>
      prisma.funnelEvent.findMany({
        where: {
          userId: { in: chunk },
          eventKey: "bot.topup.open",
          metaJson: { contains: "fv2:tu:ba:" },
        },
        select: { userId: true },
        distinct: ["userId"],
      }),
    );
    for (const h of blurHits) reached.add(h.userId);
  }
  return reached;
}

/**
 * «По факту»: события/оплаты в окне дат, любая дата регистрации.
 * firstTouch-шаги — first-touch среди событий внутри окна.
 */
async function factReachedDetailed(
  stepDef: SalesFunnelStepDef,
  win: CohortWindowArgs,
): Promise<{ users: Set<string>; breakdown?: FunnelTouchBreakdown }> {
  const reached = new Set<string>();
  if (win.partnersNone) return { users: reached };
  const partnerRel = win.partnerFilterActive
    ? { partnerAttribution: { partnerId: { in: win.partnerIds } } }
    : null;
  const at = { gte: win.from, lt: win.toExclusive };

  if (stepDef.kind === "paid" || stepDef.kind === "repeat_paid") {
    const orders = await prisma.paymentOrder.findMany({
      where: {
        status: "paid",
        paidAt: at,
        ...(partnerRel ? { user: partnerRel } : {}),
      },
      select: { userId: true },
      distinct: ["userId"],
    });
    const payerIds = orders.map((o) => o.userId);
    if (stepDef.kind === "paid") {
      for (const id of payerIds) reached.add(id);
      return { users: reached };
    }
    // Повторная: оплатил в окне и всего оплат (по конец окна) больше одной.
    const counts = await mapChunks(payerIds, (chunk) =>
      prisma.paymentOrder.groupBy({
        by: ["userId"],
        where: {
          userId: { in: chunk },
          status: "paid",
          paidAt: { lt: win.toExclusive },
        },
        _count: { _all: true },
      }),
    );
    for (const c of counts) if (c._count._all > 1) reached.add(c.userId);
    return { users: reached };
  }

  if (stepDef.kind !== "event") return { users: reached };

  if (stepDef.firstTouch) {
    const keys = stepDef.eventKeys || [];
    const [eventHits, legacyHits] = await Promise.all([
      keys.length
        ? prisma.funnelEvent.findMany({
            where: {
              at,
              eventKey: { in: keys },
              ...(partnerRel ? { user: partnerRel } : {}),
            },
            select: { userId: true, eventKey: true, metaJson: true, at: true },
            orderBy: { at: "asc" },
          })
        : Promise.resolve(
            [] as {
              userId: string;
              eventKey: string;
              metaJson: string;
              at: Date;
            }[],
          ),
      stepDef.firstTouch === "section"
        ? prisma.funnelEvent.findMany({
            where: {
              at,
              eventKey: "bot.callback.other",
              metaJson: { contains: "fv2:" },
              ...(partnerRel ? { user: partnerRel } : {}),
            },
            select: { userId: true, metaJson: true, at: true },
            orderBy: { at: "asc" },
          })
        : Promise.resolve(
            [] as { userId: string; metaJson: string; at: Date }[],
          ),
    ]);
    const ft = computeFirstTouch(stepDef.firstTouch, eventHits, legacyHits);
    return { users: ft.users, breakdown: ft.breakdown };
  }

  const [eventHits, legacyHits] = await Promise.all([
    stepDef.eventKeys?.length
      ? prisma.funnelEvent.findMany({
          where: {
            at,
            eventKey: { in: stepDef.eventKeys },
            ...(partnerRel ? { user: partnerRel } : {}),
          },
          select: { userId: true },
          distinct: ["userId"],
        })
      : Promise.resolve([] as { userId: string }[]),
    stepDef.metaContains?.length
      ? prisma.funnelEvent.findMany({
          where: {
            at,
            eventKey: "bot.callback.other",
            OR: stepDef.metaContains.map((needle) => ({
              metaJson: { contains: needle },
            })),
            ...(partnerRel ? { user: partnerRel } : {}),
          },
          select: { userId: true },
          distinct: ["userId"],
        })
      : Promise.resolve([] as { userId: string }[]),
  ]);
  for (const h of eventHits) reached.add(h.userId);
  for (const h of legacyHits) reached.add(h.userId);
  if (stepDef.key === "bot.topup.amount") {
    const blurHits = await prisma.funnelEvent.findMany({
      where: {
        at,
        eventKey: "bot.topup.open",
        metaJson: { contains: "fv2:tu:ba:" },
        ...(partnerRel ? { user: partnerRel } : {}),
      },
      select: { userId: true },
      distinct: ["userId"],
    });
    for (const h of blurHits) reached.add(h.userId);
  }
  return { users: reached };
}

async function factReachedSet(
  stepDef: SalesFunnelStepDef,
  win: CohortWindowArgs,
): Promise<Set<string>> {
  return (await factReachedDetailed(stepDef, win)).users;
}

/** Строки воронки «по факту» (main | pay) по шагам. */
async function buildFactFunnelRows(
  steps: SalesFunnelStepDef[],
  win: CohortWindowArgs,
): Promise<FunnelStepRow[]> {
  const details = await Promise.all(
    steps.map((s) => factReachedDetailed(s, win)),
  );
  const base = details[0]?.users.size || 0;
  const rows: FunnelStepRow[] = [];
  let prev = base;
  steps.forEach((s, i) => {
    const n = details[i]!.users.size;
    const row: FunnelStepRow = {
      key: s.key,
      title: s.title,
      uniqueUsers: n,
      pctOfStart: pct(n, base),
      pctOfPrev: i === 0 ? 100 : pct(n, prev),
    };
    const bd = details[i]!.breakdown;
    if (bd) row.breakdown = bd;
    rows.push(row);
    prev = n;
  });
  return rows;
}

/**
 * Люди шага воронки (main | pay).
 * view=reached — дошли до шага; view=dropped — были на предыдущем шаге, но не дошли до этого.
 */
export async function collectFunnelStepUsers(params: {
  fromYmd: string;
  toYmd: string;
  step: string;
  partnerIds?: string[] | null;
  funnel?: FunnelKind;
  basis?: FunnelBasis;
  view?: FunnelUsersView;
}): Promise<FunnelStepUsersResult> {
  const funnel: FunnelKind = params.funnel === "pay" ? "pay" : "main";
  const basis: FunnelBasis = params.basis === "fact" ? "fact" : "cohort";
  const view: FunnelUsersView = params.view === "dropped" ? "dropped" : "reached";
  const steps =
    funnel === "pay"
      ? SALES_FUNNEL_PAY_STEPS
      : basis === "fact"
        ? SALES_FUNNEL_MAIN_FACT_STEPS
        : SALES_FUNNEL_MAIN_STEPS;

  const idx = steps.findIndex((s) => s.key === params.step);
  if (idx < 0) {
    throw new Error(`Неизвестный шаг воронки: ${params.step}`);
  }
  const stepDef = steps[idx]!;
  const prevDef = idx > 0 ? steps[idx - 1]! : null;
  if (view === "dropped" && !prevDef) {
    throw new Error("У первого шага нет предыдущего");
  }

  const win = await resolveSalesCohortWindow(params);

  let cohortIds: string[] = [];
  const createdById = new Map<string, Date>();
  if (basis === "cohort") {
    const cohort = await loadStartCohort(win);
    cohortIds = cohort.map((u) => u.id);
    for (const u of cohort) createdById.set(u.id, u.regAt);
  }

  const reach = (def: SalesFunnelStepDef) =>
    basis === "fact" ? factReachedSet(def, win) : cohortReachedSet(def, cohortIds);

  let ids: Set<string>;
  if (view === "reached") {
    ids = await reach(stepDef);
  } else {
    const [prevSet, curSet] = await Promise.all([reach(prevDef!), reach(stepDef)]);
    ids = new Set([...prevSet].filter((id) => !curSet.has(id)));
  }

  // createdAt для сортировки (в fact-режиме когорты нет)
  const missing = [...ids].filter((id) => !createdById.has(id));
  if (missing.length) {
    const rows = await mapChunks(missing, (chunk) =>
      prisma.user.findMany({
        where: { id: { in: chunk } },
        select: { id: true, createdAt: true },
      }),
    );
    for (const r of rows) createdById.set(r.id, r.createdAt);
  }

  const sortedIds = [...ids].sort((a, b) => {
    const ca = createdById.get(a)?.getTime() || 0;
    const cb = createdById.get(b)?.getTime() || 0;
    return cb - ca;
  });
  const total = sortedIds.length;
  const pageIds = sortedIds.slice(0, FUNNEL_USERS_LIMIT);

  const usersRaw = pageIds.length
    ? await prisma.user.findMany({
        where: { id: { in: pageIds } },
        select: {
          id: true,
          name: true,
          createdAt: true,
          trafficLink: { select: { code: true } },
          partnerAttribution: {
            select: {
              partner: {
                select: {
                  code: true,
                  user: {
                    select: {
                      name: true,
                      platformAccounts: {
                        where: { platform: "telegram" },
                        select: { username: true },
                        take: 1,
                        orderBy: { lastSeenAt: "desc" },
                      },
                    },
                  },
                },
              },
            },
          },
          platformAccounts: {
            where: { platform: "telegram" },
            select: { platformUserId: true, username: true },
            take: 1,
            orderBy: { lastSeenAt: "desc" },
          },
        },
      })
    : [];

  const byId = new Map(usersRaw.map((u) => [u.id, u]));
  const users: FunnelStepUserRow[] = [];
  for (const id of pageIds) {
    const u = byId.get(id);
    if (!u) continue;
    const pa = u.platformAccounts[0];
    const partner = u.partnerAttribution?.partner;
    users.push({
      userId: u.id,
      tgId: pa?.platformUserId || "",
      tgUsername: pa?.username ?? null,
      name: u.name,
      partnerCode: partner?.code ?? null,
      partnerName: partner?.user?.name ?? null,
      partnerTgUsername: partner?.user?.platformAccounts?.[0]?.username ?? null,
      source: formatSalesSource(u),
      registeredAt: (createdById.get(id) ?? u.createdAt).toISOString(),
    });
  }

  return {
    funnel,
    basis,
    view,
    step: stepDef.key,
    title: stepDef.title,
    prevStep: prevDef?.key ?? null,
    prevTitle: prevDef?.title ?? null,
    fromYmd: win.fromYmd,
    toYmd: win.toYmd,
    total,
    limit: FUNNEL_USERS_LIMIT,
    users,
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
