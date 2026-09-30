"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { fmtMs, opsFetch } from "@/lib/ops/ops-fetch";

type Currency = "rub" | "peaches" | "both";
type Grain = "day" | "week" | "period";
type DatePreset = "today" | "yesterday" | "7d" | "30d" | "month" | "custom";

type FunnelStep = {
  key: string;
  title: string;
  uniqueUsers: number;
  pctOfStart: number;
  pctOfPrev: number;
  uniqueWithin7d?: number;
  pctWithin7dOfStart?: number;
  breakdown?: { photo: number; video: number; pro?: number };
};

type FunnelUserRow = {
  userId: string;
  tgId: string;
  tgUsername: string | null;
  name: string | null;
  partnerCode: string | null;
  source: string;
  registeredAt: string;
};

type FunnelUsersPayload = {
  step: string;
  title: string;
  totalReached: number;
  limit: number;
  users: FunnelUserRow[];
};

type PartnerOption = {
  id: string;
  code: string;
  name: string | null;
  tgId?: string | null;
};

type SalesPayload = {
  meta: {
    fromYmd: string;
    toYmd: string;
    currency: Currency;
    grain: Grain;
    cashGrain: Grain;
    partnerIds: string[] | "all" | "none";
    note: string;
  };
  partners: PartnerOption[];
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
  };
  cash: {
    note: string;
    rub: number;
    peaches: number;
    paymentsCount: number;
    rubPayers: number;
    peachPayers: number;
    methods: { method: string; count: number; rubMinor: number; peaches: number }[];
    series: {
      grain: Grain;
      buckets: {
        key: string;
        label: string;
        fromYmd?: string;
        toYmd?: string;
        title?: string;
        total: number;
        byMethod: { method: string; count: number }[];
      }[];
    };
  };
  funnels: FunnelStep[];
  funnelsTest: FunnelStep[];
  funnelsPay: FunnelStep[];
  funnelsPayFact: FunnelStep[];
  series: {
    grain: Grain;
    buckets: {
      key: string;
      label: string;
      fromYmd: string;
      toYmd: string;
      title?: string;
      registrations: number;
      cohortPaid: number;
      repeatPayers: number;
    }[];
  };
  bounds: { minSignupYmd: string | null; maxYmd: string };
};

const METHOD_COLOR: Record<string, string> = {
  sbp: "bg-sky-500",
  crypto: "bg-violet-500",
  cryptobot: "bg-amber-500",
  card: "bg-zinc-400",
  other: "bg-rose-400",
};

function todayMskGuess() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function addDaysYmd(ymd: string, delta: number) {
  const [y, m, d] = ymd.split("-").map(Number);
  const utc = Date.UTC(y!, m! - 1, d! + delta);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(utc));
}

function methodLabel(m: string) {
  if (m === "sbp") return "СБП";
  if (m === "crypto") return "Crypto";
  if (m === "cryptobot") return "CryptoBot";
  if (m === "card") return "Карта";
  return m;
}

function methodColor(m: string) {
  return METHOD_COLOR[m] || METHOD_COLOR.other!;
}

function fmtDur(ms: number | null) {
  if (ms == null) return "—";
  return fmtMs(ms);
}

function fmtMoney(n: number) {
  return n.toLocaleString("ru-RU", {
    maximumFractionDigits: 2,
    minimumFractionDigits: n % 1 ? 2 : 0,
  });
}

function pickGrain(f: string, t: string): Grain {
  const a = new Date(f).getTime();
  const b = new Date(t).getTime();
  const days = Math.floor((b - a) / 86_400_000) + 1;
  return days > 14 ? "week" : "day";
}

const DATE_PRESETS: { key: DatePreset; label: string }[] = [
  { key: "today", label: "Сегодня" },
  { key: "yesterday", label: "Вчера" },
  { key: "7d", label: "7д" },
  { key: "30d", label: "30д" },
  { key: "month", label: "Месяц" },
  { key: "custom", label: "Произвольный период" },
];

export default function OpsSalesPage() {
  const today = todayMskGuess();
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [currency, setCurrency] = useState<Currency>("rub");
  const [grain, setGrain] = useState<Grain>("day");
  const [cashGrain, setCashGrain] = useState<Grain>("day");
  const [grainManual, setGrainManual] = useState(false);
  const [cashGrainManual, setCashGrainManual] = useState(false);
  const [datePreset, setDatePreset] = useState<DatePreset>("today");
  const [funnelTab, setFunnelTab] = useState<"main" | "pay">("main");
  const [payMode, setPayMode] = useState<"cohort" | "fact">("cohort");
  const [selectedFunnelStep, setSelectedFunnelStep] = useState<string | null>(
    null,
  );
  const [funnelUsers, setFunnelUsers] = useState<FunnelUsersPayload | null>(
    null,
  );
  const [funnelUsersLoading, setFunnelUsersLoading] = useState(false);
  const [funnelUsersMsg, setFunnelUsersMsg] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(true);
  const [partnersOpen, setPartnersOpen] = useState(false);
  /** null = все; [] = никто; ids = фильтр */
  const [selectedPartnerIds, setSelectedPartnerIds] = useState<string[] | null>(
    null,
  );
  const [partnerSearch, setPartnerSearch] = useState("");
  const [partnerCatalog, setPartnerCatalog] = useState<PartnerOption[]>([]);
  const [data, setData] = useState<SalesPayload | null>(null);
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);
  const [minYmd, setMinYmd] = useState<string | null>(null);
  const [maxYmd, setMaxYmd] = useState(today);

  const allPartnerIds = useMemo(
    () => partnerCatalog.map((p) => p.id),
    [partnerCatalog],
  );
  const partnersNoneSelected = selectedPartnerIds?.length === 0;
  const partnersAllSelected =
    selectedPartnerIds == null ||
    (allPartnerIds.length > 0 &&
      selectedPartnerIds.length === allPartnerIds.length &&
      allPartnerIds.every((id) => selectedPartnerIds.includes(id)));

  const filteredPartners = useMemo(() => {
    const q = partnerSearch.trim().toLowerCase();
    if (!q) return partnerCatalog;
    return partnerCatalog.filter((p) => {
      const blob = `${p.code} ${p.name || ""} ${p.tgId || ""}`.toLowerCase();
      return blob.includes(q);
    });
  }, [partnerCatalog, partnerSearch]);

  const partnerSummary = useMemo(() => {
    if (partnersNoneSelected) return "Никого";
    if (partnersAllSelected) return "Все";
    if (selectedPartnerIds?.length === 1) {
      const p = partnerCatalog.find((x) => x.id === selectedPartnerIds[0]);
      return p ? partnerLabel(p) : "1 партнёр";
    }
    return `${selectedPartnerIds?.length || 0} партнёров`;
  }, [
    partnersNoneSelected,
    partnersAllSelected,
    selectedPartnerIds,
    partnerCatalog,
  ]);

  const load = useCallback(
    async (opts?: {
      from?: string;
      to?: string;
      currency?: Currency;
      grain?: Grain;
      cashGrain?: Grain;
      grainManual?: boolean;
      cashGrainManual?: boolean;
      partnerIds?: string[] | null;
    }) => {
      const f = opts?.from ?? from;
      const t = opts?.to ?? to;
      const cur = opts?.currency ?? currency;
      const gManual = opts?.grainManual ?? grainManual;
      const cManual = opts?.cashGrainManual ?? cashGrainManual;
      const pIds =
        opts && "partnerIds" in opts ? opts.partnerIds : selectedPartnerIds;
      const auto = pickGrain(f, t);
      const g = gManual ? (opts?.grain ?? grain) : auto;
      const cg = cManual ? (opts?.cashGrain ?? cashGrain) : auto;
      if (!gManual) setGrain(g);
      if (!cManual) setCashGrain(cg);
      setLoading(true);
      setMsg("");
      try {
        const q = new URLSearchParams({
          from: f,
          to: t,
          currency: cur,
          grain: g,
          cashGrain: cg,
        });
        if (pIds != null) {
          q.set("partners", pIds.length ? pIds.join(",") : "none");
        }
        const d = await opsFetch<SalesPayload>(`/api/ops/sales?${q}`);
        setData(d);
        if (d.partners?.length) setPartnerCatalog(d.partners);
        if (d.bounds.minSignupYmd) setMinYmd(d.bounds.minSignupYmd);
        setMaxYmd(d.bounds.maxYmd);
        // Clear step drill-down when filters refresh
        setSelectedFunnelStep(null);
        setFunnelUsers(null);
        setFunnelUsersMsg("");
      } catch (e) {
        setMsg(e instanceof Error ? e.message : "ошибка");
      } finally {
        setLoading(false);
      }
    },
    [
      from,
      to,
      currency,
      grain,
      cashGrain,
      grainManual,
      cashGrainManual,
      selectedPartnerIds,
    ],
  );

  const loadFunnelUsers = useCallback(
    async (step: string) => {
      setSelectedFunnelStep(step);
      setFunnelUsersLoading(true);
      setFunnelUsersMsg("");
      try {
        const q = new URLSearchParams({
          mode: "funnel_users",
          step,
          from,
          to,
        });
        if (selectedPartnerIds != null) {
          q.set(
            "partners",
            selectedPartnerIds.length ? selectedPartnerIds.join(",") : "none",
          );
        }
        const d = await opsFetch<FunnelUsersPayload>(`/api/ops/sales?${q}`);
        setFunnelUsers(d);
      } catch (e) {
        setFunnelUsers(null);
        setFunnelUsersMsg(e instanceof Error ? e.message : "ошибка");
      } finally {
        setFunnelUsersLoading(false);
      }
    },
    [from, to, selectedPartnerIds],
  );

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function applyPreset(kind: DatePreset) {
    if (kind === "custom") {
      setDatePreset("custom");
      return;
    }
    const t = maxYmd || today;
    let f = t;
    let toDate = t;
    if (kind === "today") {
      f = t;
      toDate = t;
    } else if (kind === "yesterday") {
      f = addDaysYmd(t, -1);
      toDate = f;
    } else if (kind === "7d") f = addDaysYmd(t, -6);
    else if (kind === "30d") f = addDaysYmd(t, -29);
    else if (kind === "month") f = `${t.slice(0, 8)}01`;
    if (minYmd && f < minYmd) f = minYmd;
    setFrom(f);
    setTo(toDate);
    setDatePreset(kind);
    setGrainManual(false);
    setCashGrainManual(false);
    void load({
      from: f,
      to: toDate,
      grainManual: false,
      cashGrainManual: false,
    });
  }

  function onManualDate(which: "from" | "to", value: string) {
    if (which === "from") setFrom(value);
    else setTo(value);
    setDatePreset("custom");
    setGrainManual(false);
    setCashGrainManual(false);
  }

  function selectAllPartners() {
    setSelectedPartnerIds(null);
  }

  function clearAllPartners() {
    setSelectedPartnerIds([]);
  }

  function togglePartner(id: string) {
    if (partnersNoneSelected) {
      setSelectedPartnerIds([id]);
      return;
    }
    const current = partnersAllSelected
      ? [...allPartnerIds]
      : [...(selectedPartnerIds || [])];
    const next = current.includes(id)
      ? current.filter((x) => x !== id)
      : [...current, id];
    if (!next.length) {
      setSelectedPartnerIds([]);
      return;
    }
    if (next.length === allPartnerIds.length) {
      setSelectedPartnerIds(null);
      return;
    }
    setSelectedPartnerIds(next);
  }

  const showRub = currency === "rub" || currency === "both";
  const showPeaches = currency === "peaches" || currency === "both";

  const dynMax = useMemo(() => {
    if (!data?.series.buckets.length) return 1;
    let m = 1;
    for (const b of data.series.buckets) {
      m = Math.max(m, b.registrations, b.cohortPaid, b.repeatPayers);
    }
    return m;
  }, [data]);

  const cashChartMax = useMemo(() => {
    if (!data?.cash.series.buckets.length) return 1;
    return Math.max(1, ...data.cash.series.buckets.map((b) => b.total));
  }, [data]);

  const funnel =
    funnelTab === "pay"
      ? payMode === "fact"
        ? (data?.funnelsPayFact ?? [])
        : (data?.funnelsPay ?? [])
      : (data?.funnels ?? []);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="font-display text-3xl">Аналитика</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Первичные регистрации выбранных дат и отдельно — касса за эти же даты.
          Часовой пояс: Москва.
        </p>
      </div>
      {msg ? <p className="text-sm text-rose-300">{msg}</p> : null}

      <section className="rounded-2xl border border-white/10">
        <button
          type="button"
          className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
          onClick={() => setFiltersOpen((v) => !v)}
          aria-expanded={filtersOpen}
        >
          <span className="font-display text-lg">Фильтры</span>
          <span className="text-xs text-zinc-500">
            {filtersOpen ? "Свернуть" : "Развернуть"} · {DATE_PRESETS.find((p) => p.key === datePreset)?.label}
            {" · "}
            {partnerSummary}
          </span>
        </button>
        {filtersOpen ? (
          <div className="flex flex-wrap items-end gap-2 border-t border-white/10 px-4 py-4">
            <div className="mb-1 flex w-full flex-wrap gap-1">
              {DATE_PRESETS.map(({ key, label }) => (
                <button
                  key={key}
                  type="button"
                  className={
                    datePreset === key
                      ? "rounded-full bg-white/15 px-3 py-1.5 text-xs"
                      : "rounded-full border border-white/15 px-3 py-1.5 text-xs text-zinc-400"
                  }
                  onClick={() => applyPreset(key)}
                >
                  {label}
                </button>
              ))}
            </div>
            <label className="text-xs text-zinc-500">
              Дата регистрации с
              <input
                type="date"
                value={from}
                min={minYmd || undefined}
                max={maxYmd}
                onChange={(e) => onManualDate("from", e.target.value)}
                className="mt-1 block rounded-xl border border-white/10 bg-[#121214] px-3 py-2 text-sm"
              />
            </label>
            <label className="text-xs text-zinc-500">
              по
              <input
                type="date"
                value={to}
                min={minYmd || undefined}
                max={maxYmd}
                onChange={(e) => onManualDate("to", e.target.value)}
                className="mt-1 block rounded-xl border border-white/10 bg-[#121214] px-3 py-2 text-sm"
              />
            </label>
            <label className="text-xs text-zinc-500">
              Показывать деньги
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value as Currency)}
                className="mt-1 block rounded-xl border border-white/10 bg-[#121214] px-3 py-2 text-sm"
              >
                <option value="rub">₽</option>
                <option value="peaches">🍑</option>
                <option value="both">₽ + 🍑</option>
              </select>
            </label>
            <div className="relative text-xs text-zinc-500">
              Партнёр
              <button
                type="button"
                className="mt-1 flex min-w-[11rem] items-center justify-between gap-2 rounded-xl border border-white/10 bg-[#121214] px-3 py-2 text-left text-sm text-zinc-200"
                onClick={() => setPartnersOpen((v) => !v)}
              >
                <span className="truncate">{partnerSummary}</span>
                <span className="text-zinc-500">{partnersOpen ? "▴" : "▾"}</span>
              </button>
              {partnersOpen ? (
                <div className="absolute left-0 z-20 mt-1 max-h-72 min-w-[18rem] overflow-auto rounded-xl border border-white/10 bg-[#121214] p-2 shadow-xl">
                  <input
                    type="search"
                    value={partnerSearch}
                    onChange={(e) => setPartnerSearch(e.target.value)}
                    placeholder="Поиск: имя, code, TG id"
                    className="mb-2 w-full rounded-lg border border-white/10 bg-[#0c0c0e] px-2 py-1.5 text-sm text-zinc-200"
                  />
                  <div className="mb-1 flex gap-1">
                    <button
                      type="button"
                      className="rounded-full border border-white/15 px-2 py-0.5 text-[11px] text-zinc-300"
                      onClick={() => selectAllPartners()}
                    >
                      Все
                    </button>
                    <button
                      type="button"
                      className="rounded-full border border-white/15 px-2 py-0.5 text-[11px] text-zinc-300"
                      onClick={() => clearAllPartners()}
                    >
                      Снять все
                    </button>
                  </div>
                  <label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-zinc-200 hover:bg-white/5">
                    <input
                      type="checkbox"
                      checked={partnersAllSelected}
                      onChange={() => {
                        if (partnersAllSelected) clearAllPartners();
                        else selectAllPartners();
                      }}
                    />
                    Все
                  </label>
                  {filteredPartners.length ? (
                    filteredPartners.map((p) => {
                      const checked =
                        partnersAllSelected ||
                        Boolean(selectedPartnerIds?.includes(p.id));
                      return (
                        <label
                          key={p.id}
                          className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-zinc-300 hover:bg-white/5"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => togglePartner(p.id)}
                          />
                          <span className="truncate">{partnerLabel(p)}</span>
                        </label>
                      );
                    })
                  ) : (
                    <p className="px-2 py-1.5 text-xs text-zinc-600">
                      {partnerCatalog.length
                        ? "Ничего не найдено"
                        : "Список подтянется после загрузки"}
                    </p>
                  )}
                </div>
              ) : null}
            </div>
            <button
              type="button"
              className="rounded-full btn-grad px-4 py-2 text-sm"
              disabled={loading}
              onClick={() => {
                setPartnersOpen(false);
                void load({ partnerIds: selectedPartnerIds });
              }}
            >
              {loading ? "Считаю…" : "Обновить"}
            </button>
          </div>
        ) : null}
      </section>

      {!data ? (
        <p className="text-sm text-zinc-500">Загрузка…</p>
      ) : (
        <>
          <p className="text-xs text-zinc-500">{data.meta.note}</p>

          <section>
            <h2 className="mb-2 text-sm font-medium text-zinc-300">
              Первичные регистрации (даты из фильтра)
            </h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Kpi
                label="Регистраций (kpi.newUsers)"
                hint="Telegram User.createdAt, календарный день MSK"
                value={String(data.kpi.newUsers)}
              />
              <Kpi
                label="Оплат"
                hint="Успешные оплаты этих регистраций (на момент отчёта)"
                value={String(data.kpi.paymentsCount)}
              />
              {showRub ? (
                <Kpi
                  label="Сумма оплат, ₽"
                  hint="Сумма ₽ по оплатам этих регистраций"
                  value={fmtMoney(data.kpi.revenueSumRub)}
                />
              ) : null}
              {showPeaches ? (
                <Kpi
                  label="Сумма оплат, 🍑"
                  hint="Topup-персики этих регистраций"
                  value={fmtMoney(data.kpi.revenueSumPeaches)}
                />
              ) : null}
              <Kpi
                label="Время до первой оплаты"
                hint="Среди тех с первичной регистрацией в периоде, кто уже оплатил"
                value={`ср ${fmtDur(data.kpi.avgMsToFirstPay)} · мед ${fmtDur(data.kpi.medianMsToFirstPay)}`}
              />
              {showRub ? (
                <Kpi
                  label="Доход на регистрацию, ₽"
                  hint="Сумма оплат ÷ число регистраций"
                  value={fmtMoney(data.kpi.revenuePerRegRub)}
                />
              ) : null}
              {showPeaches ? (
                <Kpi
                  label="Доход на регистрацию, 🍑"
                  hint="Сумма 🍑 ÷ число регистраций"
                  value={fmtMoney(data.kpi.revenuePerRegPeaches)}
                />
              ) : null}
              <Kpi
                label="Оплат на регистрацию"
                hint="Число оплат ÷ число регистраций"
                value={fmtMoney(data.kpi.paymentsPerReg)}
              />
            </div>
          </section>

          <section className="rounded-2xl border border-white/10 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-display text-xl">Касса за эти даты</h2>
              <GrainToggle
                value={cashGrain}
                onChange={(g) => {
                  setCashGrain(g);
                  setCashGrainManual(true);
                  void load({ cashGrain: g, cashGrainManual: true });
                }}
              />
            </div>
            <p className="mt-1 text-xs text-zinc-500">{data.cash.note}</p>
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm">
              {showRub ? (
                <span>
                  <b className="text-peach">{fmtMoney(data.cash.rub)}</b> ₽
                  <span className="text-zinc-500">
                    {" "}
                    · {data.cash.paymentsCount} оплат · {data.cash.rubPayers}{" "}
                    плательщиков
                  </span>
                </span>
              ) : null}
              {showPeaches ? (
                <span>
                  <b className="text-peach">{data.cash.peaches}</b> 🍑
                  <span className="text-zinc-500">
                    {" "}
                    · {data.cash.peachPayers} чел. с topup
                  </span>
                </span>
              ) : null}
            </div>

            <p className="mt-4 text-xs text-zinc-500">
              Число оплат {grainHint(cashGrain)}. Цвет столбца — метод оплаты.
            </p>
            <div className="mt-2 flex flex-wrap gap-3 text-[10px] text-zinc-500">
              {["sbp", "crypto", "cryptobot", "card", "other"].map((m) => (
                <span key={m} className="inline-flex items-center gap-1.5">
                  <span className={`h-2 w-2 rounded-sm ${methodColor(m)}`} />
                  {methodLabel(m)}
                </span>
              ))}
            </div>
            <VerticalStackedCashChart
              buckets={data.cash.series.buckets}
              maxTotal={cashChartMax}
            />

            {data.cash.methods.length ? (
              <ul className="mt-3 space-y-1 text-sm text-zinc-400">
                {data.cash.methods.map((m) => (
                  <li
                    key={m.method}
                    className="flex justify-between gap-2 border-t border-white/5 py-1"
                  >
                    <span className="inline-flex items-center gap-2">
                      <span
                        className={`h-2 w-2 rounded-sm ${methodColor(m.method)}`}
                      />
                      {methodLabel(m.method)}
                    </span>
                    <span className="font-mono text-zinc-300">
                      {m.count} опл.
                      {showRub ? ` · ${fmtMoney(m.rubMinor / 100)} ₽` : ""}
                      {showPeaches ? ` · ${m.peaches} 🍑` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-zinc-600">В эти даты оплат не было</p>
            )}
          </section>

          <section className="rounded-2xl border border-white/10 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-display text-xl">Динамика первичных регистраций</h2>
              <GrainToggle
                value={grain}
                onChange={(g) => {
                  setGrain(g);
                  setGrainManual(true);
                  void load({ grain: g, grainManual: true });
                }}
              />
            </div>
            <ul className="mt-2 space-y-0.5 text-xs text-zinc-500">
              <li>
                <span className="text-zinc-400">серый</span> — регистрации{" "}
                {grainHint(grain)}
              </li>
              <li>
                <span className="text-emerald-400/90">зелёный</span> — из них уже
                оплатили хотя бы раз
              </li>
              <li>
                <span className="text-amber-300">жёлтый</span> — повторные оплаты
                (&gt;1 успешной оплаты)
              </li>
            </ul>
            <VerticalDynamicsChart buckets={data.series.buckets} max={dynMax} />
          </section>

          <section className="rounded-2xl border border-white/10 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-display text-xl">Воронка первичных регистраций</h2>
              <div className="flex flex-wrap gap-1">
                <button
                  type="button"
                  className={
                    funnelTab === "main"
                      ? "rounded-full bg-white/15 px-3 py-1 text-xs"
                      : "rounded-full border border-white/15 px-3 py-1 text-xs text-zinc-400"
                  }
                  onClick={() => {
                    setFunnelTab("main");
                  }}
                >
                  Основная
                </button>
                <button
                  type="button"
                  className={
                    funnelTab === "pay"
                      ? "rounded-full bg-white/15 px-3 py-1 text-xs"
                      : "rounded-full border border-white/15 px-3 py-1 text-xs text-zinc-400"
                  }
                  onClick={() => {
                    setFunnelTab("pay");
                    setSelectedFunnelStep(null);
                    setFunnelUsers(null);
                    setFunnelUsersMsg("");
                  }}
                >
                  Оплаты
                </button>
              </div>
            </div>
            <p className="mt-1 text-xs text-zinc-500">
              {funnelTab === "main"
                ? "Основная: вход (/start) → правила → меню → раздел → генерация → топап → оплаты. Клик по шагу — список людей. «% от всех» — от входа."
                : payMode === "fact"
                  ? "Оплаты по факту: шаги и оплаты, случившиеся в выбранные даты (дата регистрации не важна). «% от всех» — от «открыл пополнение» за эти даты."
                  : "Оплаты по регистрации: среди зарегистрированных в выбранные даты. Открыл → сумма → способ → ссылка → оплатил (оплата могла быть позже)."}
            </p>
            {funnelTab === "pay" ? (
              <div className="mt-3 flex flex-wrap gap-1">
                <button
                  type="button"
                  className={
                    payMode === "cohort"
                      ? "rounded-full bg-white/15 px-3 py-1 text-xs"
                      : "rounded-full border border-white/15 px-3 py-1 text-xs text-zinc-400"
                  }
                  onClick={() => setPayMode("cohort")}
                >
                  По дате регистрации
                </button>
                <button
                  type="button"
                  className={
                    payMode === "fact"
                      ? "rounded-full bg-white/15 px-3 py-1 text-xs"
                      : "rounded-full border border-white/15 px-3 py-1 text-xs text-zinc-400"
                  }
                  onClick={() => setPayMode("fact")}
                >
                  По факту
                </button>
              </div>
            ) : null}
            <ul className="mt-4 space-y-3">
              {funnel.map((f, i) => {
                const dropHard = i > 0 && f.pctOfPrev < 50 && f.uniqueUsers > 0;
                const jumpUp = i > 0 && f.uniqueUsers > 0 && f.pctOfPrev > 100;
                const selected =
                  funnelTab === "main" && selectedFunnelStep === f.key;
                const clickable = funnelTab === "main";
                const bd = f.breakdown;
                return (
                  <li key={f.key}>
                    <button
                      type="button"
                      disabled={!clickable}
                      onClick={() => {
                        if (!clickable) return;
                        void loadFunnelUsers(f.key);
                      }}
                      className={
                        clickable
                          ? `mb-1 w-full rounded-xl px-2 py-1.5 text-left transition ${
                              selected
                                ? "bg-peach/15 ring-1 ring-peach/40"
                                : "hover:bg-white/5"
                            }`
                          : "mb-1 w-full px-2 py-1.5 text-left"
                      }
                    >
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <span className="text-sm text-zinc-200">
                          {i + 1}. {f.title}
                          {clickable ? (
                            <span className="ml-2 text-[10px] text-zinc-600">
                              люди →
                            </span>
                          ) : null}
                        </span>
                        <span className="font-mono text-sm">
                          <b className="text-peach">{f.uniqueUsers}</b>
                          <span className="text-zinc-500">
                            {" "}
                            · {f.pctOfStart}% от всех
                            {i > 0 ? (
                              <span
                                className={
                                  dropHard
                                    ? " text-rose-300"
                                    : jumpUp
                                      ? " text-amber-300"
                                      : ""
                                }
                              >
                                {" "}
                                · {f.pctOfPrev}% от шага выше
                              </span>
                            ) : null}
                            {f.uniqueWithin7d != null ? (
                              <span className="text-zinc-600">
                                {" "}
                                · за ≤7 дней: {f.uniqueWithin7d} (
                                {f.pctWithin7dOfStart}%)
                              </span>
                            ) : null}
                          </span>
                        </span>
                      </div>
                      {bd ? (
                        <p className="mt-0.5 text-[11px] text-zinc-500">
                          first-touch: фото {bd.photo} · видео {bd.video}
                          {bd.pro != null ? ` · pro ${bd.pro}` : ""}
                        </p>
                      ) : null}
                      <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-white/5">
                        <div
                          className={
                            dropHard
                              ? "h-full rounded-full bg-rose-400/80 transition-all"
                              : "h-full rounded-full bg-peach/80 transition-all"
                          }
                          style={{ width: `${Math.min(100, f.pctOfStart)}%` }}
                        />
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>

          {funnelTab === "main" && selectedFunnelStep ? (
            <section className="rounded-2xl border border-white/10 p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="font-display text-xl">
                  Люди на шаге
                  {funnelUsers ? `: ${funnelUsers.title}` : ""}
                </h2>
                <button
                  type="button"
                  className="text-xs text-zinc-500 hover:text-zinc-300"
                  onClick={() => {
                    setSelectedFunnelStep(null);
                    setFunnelUsers(null);
                    setFunnelUsersMsg("");
                  }}
                >
                  Закрыть
                </button>
              </div>
              <p className="mt-1 text-xs text-zinc-500">
                {funnelUsers
                  ? `Показано ${funnelUsers.users.length} из ${funnelUsers.totalReached} (лимит ${funnelUsers.limit}).`
                  : "Загрузка списка…"}
              </p>
              {funnelUsersMsg ? (
                <p className="mt-2 text-sm text-rose-300">{funnelUsersMsg}</p>
              ) : null}
              {funnelUsersLoading ? (
                <p className="mt-3 text-sm text-zinc-500">Считаю…</p>
              ) : funnelUsers?.users.length ? (
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full min-w-[48rem] text-left text-xs">
                    <thead className="text-[10px] uppercase tracking-wider text-zinc-500">
                      <tr className="border-b border-white/10">
                        <th className="py-2 pr-3 font-medium">@username</th>
                        <th className="py-2 pr-3 font-medium">Имя</th>
                        <th className="py-2 pr-3 font-medium">Партнёр</th>
                        <th className="py-2 pr-3 font-medium">Источник</th>
                        <th className="py-2 pr-3 font-medium">Регистрация</th>
                        <th className="py-2 pr-3 font-medium">tgId</th>
                      </tr>
                    </thead>
                    <tbody>
                      {funnelUsers.users.map((u) => (
                        <tr
                          key={u.userId}
                          className="border-b border-white/5 text-zinc-300"
                        >
                          <td className="py-1.5 pr-3 font-mono">
                            {u.tgUsername ? `@${u.tgUsername}` : "—"}
                          </td>
                          <td className="py-1.5 pr-3">{u.name || "—"}</td>
                          <td className="py-1.5 pr-3 font-mono">
                            {u.partnerCode || "—"}
                          </td>
                          <td className="py-1.5 pr-3 font-mono text-zinc-400">
                            {u.source}
                          </td>
                          <td className="py-1.5 pr-3 font-mono text-zinc-400">
                            {u.registeredAt.slice(0, 19).replace("T", " ")}
                          </td>
                          <td className="py-1.5 pr-3 font-mono text-zinc-500">
                            {u.tgId || "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : funnelUsers && !funnelUsersLoading ? (
                <p className="mt-3 text-sm text-zinc-600">
                  На этом шаге никого в выборке
                </p>
              ) : null}
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}

function partnerLabel(p: PartnerOption) {
  const who = p.name ? `${p.code} · ${p.name}` : p.code;
  return p.tgId ? `${who} · ${p.tgId}` : who;
}

function grainHint(g: Grain) {
  if (g === "period") return "за весь выбранный период";
  if (g === "week") return "по неделям (только дни внутри фильтра)";
  return "по дням";
}

function GrainToggle({
  value,
  onChange,
}: {
  value: Grain;
  onChange: (g: Grain) => void;
}) {
  const btn = (g: Grain, label: string) => (
    <button
      type="button"
      className={
        value === g
          ? "rounded-full bg-white/15 px-3 py-1 text-xs"
          : "rounded-full border border-white/15 px-3 py-1 text-xs text-zinc-400"
      }
      onClick={() => onChange(g)}
    >
      {label}
    </button>
  );
  return (
    <div className="flex flex-wrap gap-1">
      {btn("period", "За период")}
      {btn("day", "Дни")}
      {btn("week", "Недели")}
    </div>
  );
}

const CHART_H = 128;

function colHeight(value: number, max: number) {
  if (max <= 0 || value <= 0) return 0;
  return Math.max(4, Math.round((value / max) * CHART_H));
}

function fmtDdMm(ymd: string) {
  return `${ymd.slice(8, 10)}.${ymd.slice(5, 7)}`;
}

function ChartAxisLabel({
  label,
  fromYmd,
  toYmd,
  title,
}: {
  label: string;
  fromYmd?: string;
  toYmd?: string;
  title?: string;
}) {
  const full =
    title ||
    (fromYmd && toYmd
      ? fromYmd === toYmd
        ? fromYmd
        : `${fromYmd} – ${toYmd}`
      : label);
  const isRange = Boolean(fromYmd && toYmd && fromYmd !== toYmd);

  // Диапазон всегда в 2 строки — без truncate/…; hover = полные YYYY-MM-DD
  if (isRange && fromYmd && toYmd) {
    return (
      <span
        className="block min-w-[2.75rem] cursor-default text-center font-mono text-[9px] leading-tight text-zinc-500"
        title={full}
      >
        <span className="block">{fmtDdMm(fromYmd)}</span>
        <span className="block text-[8px] text-zinc-600">–</span>
        <span className="block">{fmtDdMm(toYmd)}</span>
      </span>
    );
  }

  return (
    <span
      className="block min-w-[2.5rem] cursor-default whitespace-nowrap text-center font-mono text-[9px] leading-tight text-zinc-500"
      title={full}
    >
      {fromYmd ? fmtDdMm(fromYmd) : label}
    </span>
  );
}

function VerticalStackedCashChart({
  buckets,
  maxTotal,
}: {
  buckets: SalesPayload["cash"]["series"]["buckets"];
  maxTotal: number;
}) {
  return (
    <div className="mt-4 overflow-x-auto pb-1">
      <div
        className="flex min-w-full items-end justify-center gap-2 sm:gap-3"
        style={{ minHeight: CHART_H + 52 }}
      >
        {buckets.map((b) => {
          const h = colHeight(b.total, maxTotal);
          return (
            <div
              key={b.key}
              className="flex w-12 shrink-0 flex-col items-center gap-1 sm:w-14"
            >
              <span className="font-mono text-[10px] text-zinc-500">
                {b.total || ""}
              </span>
              <div
                className="flex w-full flex-col-reverse overflow-hidden rounded-t-md bg-white/5"
                style={{ height: h || 2 }}
                title={b.byMethod
                  .map((s) => `${methodLabel(s.method)}: ${s.count}`)
                  .join(", ")}
              >
                {b.total > 0
                  ? b.byMethod.map((slice) => (
                      <div
                        key={slice.method}
                        className={`w-full ${methodColor(slice.method)}`}
                        style={{
                          flexGrow: slice.count,
                          flexBasis: 0,
                          minHeight: slice.count > 0 ? 2 : 0,
                        }}
                      />
                    ))
                  : null}
              </div>
              <ChartAxisLabel
                label={b.label}
                fromYmd={b.fromYmd}
                toYmd={b.toYmd}
                title={b.title}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function VerticalDynamicsChart({
  buckets,
  max,
}: {
  buckets: SalesPayload["series"]["buckets"];
  max: number;
}) {
  const series = [
    { key: "reg", color: "bg-zinc-400", get: (b: (typeof buckets)[0]) => b.registrations },
    {
      key: "paid",
      color: "bg-emerald-500/80",
      get: (b: (typeof buckets)[0]) => b.cohortPaid,
    },
    {
      key: "rep",
      color: "bg-amber-400/80",
      get: (b: (typeof buckets)[0]) => b.repeatPayers,
    },
  ] as const;
  return (
    <div className="mt-4 overflow-x-auto pb-1">
      <div
        className="flex min-w-full items-end justify-center gap-3 sm:gap-4"
        style={{ minHeight: CHART_H + 64 }}
      >
        {buckets.map((b) => (
          <div
            key={b.key}
            className="flex min-w-[3.5rem] shrink-0 flex-col items-center gap-1"
          >
            <div className="flex items-end gap-1">
              {series.map((s) => {
                const v = s.get(b);
                return (
                  <div
                    key={s.key}
                    className="flex w-6 flex-col items-center gap-0.5"
                  >
                    <span className="font-mono text-[9px] leading-none text-zinc-400">
                      {v}
                    </span>
                    <div
                      className={`w-2.5 rounded-t-sm ${s.color}`}
                      style={{ height: colHeight(v, max) }}
                      title={`${s.key}: ${v}`}
                    />
                  </div>
                );
              })}
            </div>
            <ChartAxisLabel
              label={b.label}
              fromYmd={b.fromYmd}
              toYmd={b.toYmd}
              title={b.title}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function Kpi({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 p-4">
      <div className="text-[11px] uppercase tracking-wide text-zinc-500">
        {label}
      </div>
      <div className="mt-1 text-lg leading-snug">{value}</div>
      {hint ? (
        <p className="mt-1 text-[11px] leading-snug text-zinc-600">{hint}</p>
      ) : null}
    </div>
  );
}
