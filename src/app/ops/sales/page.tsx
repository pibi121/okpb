"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { fmtMs, opsFetch } from "@/lib/ops/ops-fetch";

type Currency = "rub" | "peaches" | "both";
type Grain = "day" | "week";

type FunnelStep = {
  key: string;
  title: string;
  uniqueUsers: number;
  pctOfStart: number;
  pctOfPrev: number;
  uniqueWithin7d?: number;
  pctWithin7dOfStart?: number;
};

type SalesPayload = {
  meta: {
    fromYmd: string;
    toYmd: string;
    currency: Currency;
    grain: Grain;
    minSignupYmd: string | null;
    maxYmd: string;
    note: string;
  };
  kpi: {
    newUsers: number;
    payers: number;
    payersWithin7d: number;
    paymentsCount: number;
    avgMsToFirstPay: number | null;
    medianMsToFirstPay: number | null;
    arpuRub: number;
    arppuRub: number;
    arpuPeaches: number;
    arppuPeaches: number;
    avgPaymentsPerPayer: number;
  };
  cash: {
    note: string;
    rub: number;
    peaches: number;
    paymentsCount: number;
    payers: number;
    methods: { method: string; count: number; rubMinor: number; peaches: number }[];
  };
  funnel: FunnelStep[];
  series: {
    grain: Grain;
    buckets: {
      key: string;
      label: string;
      registrations: number;
      cohortPaid: number;
      cashRub: number;
      cashPeaches: number;
      cashPayments: number;
    }[];
  };
  bounds: { minSignupYmd: string | null; maxYmd: string };
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

export default function OpsSalesPage() {
  const today = todayMskGuess();
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [currency, setCurrency] = useState<Currency>("rub");
  const [grain, setGrain] = useState<Grain>("day");
  const [grainManual, setGrainManual] = useState(false);
  const [data, setData] = useState<SalesPayload | null>(null);
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);
  const [minYmd, setMinYmd] = useState<string | null>(null);
  const [maxYmd, setMaxYmd] = useState(today);

  const load = useCallback(
    async (opts?: {
      from?: string;
      to?: string;
      currency?: Currency;
      grain?: Grain;
      grainManual?: boolean;
    }) => {
      const f = opts?.from ?? from;
      const t = opts?.to ?? to;
      const cur = opts?.currency ?? currency;
      const manual = opts?.grainManual ?? grainManual;
      const g = manual
        ? (opts?.grain ?? grain)
        : pickGrain(f, t);
      if (!manual) setGrain(g);
      setLoading(true);
      setMsg("");
      try {
        const q = new URLSearchParams({
          from: f,
          to: t,
          currency: cur,
          grain: g,
        });
        const d = await opsFetch<SalesPayload>(`/api/ops/sales?${q}`);
        setData(d);
        if (d.bounds.minSignupYmd) setMinYmd(d.bounds.minSignupYmd);
        setMaxYmd(d.bounds.maxYmd);
      } catch (e) {
        setMsg(e instanceof Error ? e.message : "ошибка");
      } finally {
        setLoading(false);
      }
    },
    [from, to, currency, grain, grainManual],
  );

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function applyPreset(kind: string) {
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
    setGrainManual(false);
    void load({ from: f, to: toDate, grainManual: false });
  }

  const showRub = currency === "rub" || currency === "both";
  const showPeaches = currency === "peaches" || currency === "both";

  const chartMax = useMemo(() => {
    if (!data?.series.buckets.length) return 1;
    let m = 1;
    for (const b of data.series.buckets) {
      m = Math.max(
        m,
        b.registrations,
        b.cohortPaid,
        showRub ? b.cashRub : 0,
        showPeaches ? b.cashPeaches : 0,
      );
    }
    return m;
  }, [data, showRub, showPeaches]);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="font-display text-3xl">Аналитика</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Когорта по дате регистрации · касса отдельно по факту оплаты · даты MSK
        </p>
      </div>
      {msg ? <p className="text-sm text-rose-300">{msg}</p> : null}

      <div className="flex flex-wrap items-end gap-2 rounded-2xl border border-white/10 p-4">
        <label className="text-xs text-zinc-500">
          От
          <input
            type="date"
            value={from}
            min={minYmd || undefined}
            max={maxYmd}
            onChange={(e) => {
              setFrom(e.target.value);
              setGrainManual(false);
            }}
            className="mt-1 block rounded-xl border border-white/10 bg-[#121214] px-3 py-2 text-sm"
          />
        </label>
        <label className="text-xs text-zinc-500">
          До
          <input
            type="date"
            value={to}
            min={minYmd || undefined}
            max={maxYmd}
            onChange={(e) => {
              setTo(e.target.value);
              setGrainManual(false);
            }}
            className="mt-1 block rounded-xl border border-white/10 bg-[#121214] px-3 py-2 text-sm"
          />
        </label>
        <label className="text-xs text-zinc-500">
          Валюта
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
        <label className="text-xs text-zinc-500">
          Зерно
          <select
            value={grain}
            onChange={(e) => {
              setGrain(e.target.value as Grain);
              setGrainManual(true);
            }}
            className="mt-1 block rounded-xl border border-white/10 bg-[#121214] px-3 py-2 text-sm"
          >
            <option value="day">Дни</option>
            <option value="week">Недели</option>
          </select>
        </label>
        <button
          type="button"
          className="rounded-full btn-grad px-4 py-2 text-sm"
          disabled={loading}
          onClick={() => void load()}
        >
          {loading ? "Считаю…" : "Обновить"}
        </button>
        <div className="flex flex-wrap gap-1">
          {(
            [
              ["today", "Сегодня"],
              ["yesterday", "Вчера"],
              ["7d", "7д"],
              ["30d", "30д"],
              ["month", "Месяц"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              className="rounded-full border border-white/15 px-3 py-1.5 text-xs text-zinc-300"
              onClick={() => applyPreset(k)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {!data ? (
        <p className="text-sm text-zinc-500">Загрузка…</p>
      ) : (
        <>
          <p className="text-xs text-zinc-500">{data.meta.note}</p>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi label="Новые юзеры" value={String(data.kpi.newUsers)} />
            <Kpi
              label="Заплатили"
              value={`${data.kpi.payers} (${data.kpi.payersWithin7d} ≤7д)`}
            />
            <Kpi
              label="До 1-й оплаты"
              value={`ср ${fmtDur(data.kpi.avgMsToFirstPay)} · мед ${fmtDur(data.kpi.medianMsToFirstPay)}`}
            />
            <Kpi
              label="Оплат / платящего"
              value={String(data.kpi.avgPaymentsPerPayer)}
            />
            {showRub ? (
              <>
                <Kpi label="ARPU ₽" value={fmtMoney(data.kpi.arpuRub)} />
                <Kpi label="ARPPU ₽" value={fmtMoney(data.kpi.arppuRub)} />
              </>
            ) : null}
            {showPeaches ? (
              <>
                <Kpi label="ARPU 🍑" value={String(data.kpi.arpuPeaches)} />
                <Kpi label="ARPPU 🍑" value={String(data.kpi.arppuPeaches)} />
              </>
            ) : null}
          </div>

          <section className="rounded-2xl border border-white/10 p-4">
            <h2 className="font-display text-xl">Оплаты за период</h2>
            <p className="mt-1 text-xs text-zinc-500">{data.cash.note}</p>
            <div className="mt-3 flex flex-wrap gap-4 text-sm">
              {showRub ? (
                <span>
                  <b className="text-peach">{fmtMoney(data.cash.rub)}</b> ₽
                </span>
              ) : null}
              {showPeaches ? (
                <span>
                  <b className="text-peach">{data.cash.peaches}</b> 🍑
                </span>
              ) : null}
              <span className="text-zinc-400">
                {data.cash.paymentsCount} оплат · {data.cash.payers} плательщиков
              </span>
            </div>
            {data.cash.methods.length ? (
              <ul className="mt-3 space-y-1 text-sm text-zinc-400">
                {data.cash.methods.map((m) => (
                  <li
                    key={m.method}
                    className="flex justify-between gap-2 border-t border-white/5 py-1"
                  >
                    <span>{methodLabel(m.method)}</span>
                    <span className="font-mono text-zinc-300">
                      {m.count}
                      {showRub ? ` · ${fmtMoney(m.rubMinor / 100)} ₽` : ""}
                      {showPeaches ? ` · ${m.peaches} 🍑` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-zinc-600">Нет оплат в окне</p>
            )}
          </section>

          <section className="rounded-2xl border border-white/10 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-display text-xl">Динамика</h2>
              <div className="flex gap-1">
                <button
                  type="button"
                  className={
                    grain === "day"
                      ? "rounded-full bg-white/15 px-3 py-1 text-xs"
                      : "rounded-full border border-white/15 px-3 py-1 text-xs text-zinc-400"
                  }
                  onClick={() => {
                    setGrain("day");
                    setGrainManual(true);
                    void load({ grain: "day", grainManual: true });
                  }}
                >
                  Дни
                </button>
                <button
                  type="button"
                  className={
                    grain === "week"
                      ? "rounded-full bg-white/15 px-3 py-1 text-xs"
                      : "rounded-full border border-white/15 px-3 py-1 text-xs text-zinc-400"
                  }
                  onClick={() => {
                    setGrain("week");
                    setGrainManual(true);
                    void load({ grain: "week", grainManual: true });
                  }}
                >
                  Недели
                </button>
              </div>
            </div>
            <p className="mt-1 text-xs text-zinc-500">
              Регистрации · оплатившие из когорты бакета (ever) · касса по paidAt
            </p>
            <div className="mt-4 space-y-2">
              {data.series.buckets.map((b) => (
                <div
                  key={b.key}
                  className="grid grid-cols-[4.5rem_1fr] items-center gap-2 text-xs"
                >
                  <span className="font-mono text-zinc-500">{b.label}</span>
                  <div className="space-y-0.5">
                    <Bar
                      color="bg-zinc-400"
                      value={b.registrations}
                      max={chartMax}
                      label={`рег ${b.registrations}`}
                    />
                    <Bar
                      color="bg-emerald-500/80"
                      value={b.cohortPaid}
                      max={chartMax}
                      label={`опл. ког. ${b.cohortPaid}`}
                    />
                    {showRub ? (
                      <Bar
                        color="bg-peach/80"
                        value={b.cashRub}
                        max={chartMax}
                        label={`касса ${fmtMoney(b.cashRub)} ₽`}
                      />
                    ) : null}
                    {showPeaches ? (
                      <Bar
                        color="bg-amber-400/70"
                        value={b.cashPeaches}
                        max={chartMax}
                        label={`касса ${b.cashPeaches} 🍑`}
                      />
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-2xl border border-white/10 p-4">
            <h2 className="font-display text-xl">Воронка когорты</h2>
            <p className="mt-1 text-xs text-zinc-500">
              Уники · % от регистрации · % к предыдущему шагу. Бар = доля от старта.
            </p>
            <ul className="mt-4 space-y-3">
              {data.funnel.map((f, i) => {
                const dropHard = i > 0 && f.pctOfPrev < 50;
                return (
                  <li key={f.key}>
                    <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
                      <span className="text-sm text-zinc-200">
                        {i + 1}. {f.title}
                      </span>
                      <span className="font-mono text-sm">
                        <b className="text-peach">{f.uniqueUsers}</b>
                        <span className="text-zinc-500">
                          {" "}
                          · {f.pctOfStart}% старт
                          {i > 0 ? (
                            <span className={dropHard ? " text-rose-300" : ""}>
                              {" "}
                              · {f.pctOfPrev}% к пред.
                            </span>
                          ) : null}
                          {f.uniqueWithin7d != null ? (
                            <span className="text-zinc-600">
                              {" "}
                              · ≤7д: {f.uniqueWithin7d} ({f.pctWithin7dOfStart}
                              %)
                            </span>
                          ) : null}
                        </span>
                      </span>
                    </div>
                    <div className="h-2.5 overflow-hidden rounded-full bg-white/5">
                      <div
                        className={
                          dropHard
                            ? "h-full rounded-full bg-rose-400/80 transition-all"
                            : "h-full rounded-full bg-peach/80 transition-all"
                        }
                        style={{ width: `${Math.min(100, f.pctOfStart)}%` }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 p-4">
      <div className="text-[11px] uppercase tracking-wide text-zinc-500">
        {label}
      </div>
      <div className="mt-1 text-lg leading-snug">{value}</div>
    </div>
  );
}

function Bar({
  color,
  value,
  max,
  label,
}: {
  color: string;
  value: number;
  max: number;
  label: string;
}) {
  const w = max > 0 ? Math.max(value > 0 ? 2 : 0, (value / max) * 100) : 0;
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/5">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${w}%` }} />
      </div>
      <span className="w-28 shrink-0 text-right font-mono text-[10px] text-zinc-500">
        {label}
      </span>
    </div>
  );
}
