"use client";

import { useEffect, useRef, useState } from "react";
import { opsFetch } from "@/lib/ops/ops-fetch";
import type { GrowthDashboard, LangSlice } from "@/lib/ops/growth-plan";

function mskToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Moscow" });
}

function addDays(ymd: string, delta: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y || 2026, (m || 1) - 1, d || 1));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return dt.toISOString().slice(0, 10);
}

function rub(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${Math.round(n).toLocaleString("ru-RU")} ₽`;
}

function pct(n: number | null | undefined, digits = 1): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${(n * 100).toLocaleString("ru-RU", { maximumFractionDigits: digits, minimumFractionDigits: digits })}%`;
}

function num(n: number | null | undefined, digits = 0): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("ru-RU", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

function parseNum(s: string): number {
  return Number(s.replace(",", ".").trim() || 0);
}

function people(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${Math.round(n).toLocaleString("ru-RU")} чел.`;
}

function dayLabel(ymd: string): string {
  const [y, m, d] = ymd.split("-");
  return `${d}.${m}.${y}`;
}

function gapText(days: number | null): string {
  if (days == null || !Number.isFinite(days)) return "—";
  const abs = Math.abs(days);
  if (abs < 0.05) return "в темпе";
  const n = abs.toLocaleString("ru-RU", { maximumFractionDigits: 1, minimumFractionDigits: 1 });
  return days > 0 ? `сзади на ${n}` : `впереди на ${n}`;
}

function ruLine(slice: LangSlice): string {
  if (!slice.total) return "—";
  if (!slice.known) return `язык не записан (${slice.total})`;
  const unknown = slice.total - slice.known;
  const base = pct(slice.ruShare);
  return unknown > 0 ? `${base} · без языка ${unknown}` : base;
}

function langLine(slice: LangSlice): string {
  if (!slice.top.length) return "—";
  return slice.top
    .map((t) => `${t.code} ${t.count}`)
    .join(" · ");
}

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-white/10 p-4">
      <div className="text-[11px] uppercase tracking-wide text-zinc-500">{label}</div>
      <div className="mt-1 text-2xl">{value}</div>
      {hint ? <p className="mt-1 text-xs text-zinc-500">{hint}</p> : null}
    </div>
  );
}

export default function OpsGrowthPage() {
  const today = mskToday();
  const [from, setFrom] = useState(() => addDays(today, -29));
  const [to, setTo] = useState(today);
  const [draftFrom, setDraftFrom] = useState(() => addDays(today, -29));
  const [draftTo, setDraftTo] = useState(today);
  const [data, setData] = useState<GrowthDashboard | null>(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);
  const [goal, setGoal] = useState("");
  const [fee, setFee] = useState("0");
  const [gpu, setGpu] = useState("0");
  const formReady = useRef(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    let cancel = false;
    const q = new URLSearchParams({ from, to });
    opsFetch<GrowthDashboard>(`/api/ops/growth?${q}`)
      .then((d) => {
        if (cancel) return;
        setData(d);
        setErr("");
        if (!formReady.current) {
          setGoal(d.settings.monthlyNetGoalRub ? String(d.settings.monthlyNetGoalRub) : "");
          setFee(String(d.settings.paymentFeePct || 0));
          setGpu(String(d.settings.gpuDailyRub || 0));
          formReady.current = true;
        }
      })
      .catch((e) => {
        if (!cancel) setErr(e instanceof Error ? e.message : "ошибка");
      })
      .finally(() => {
        if (!cancel) setLoading(false);
      });
    return () => {
      cancel = true;
    };
  }, [from, to]);

function applyRange(nextFrom: string, nextTo: string) {
  setDraftFrom(nextFrom);
  setDraftTo(nextTo);
  if (nextFrom !== from || nextTo !== to) setLoading(true);
  setFrom(nextFrom);
  setTo(nextTo);
}

  async function save(patch: Record<string, unknown>) {
    setSaving(true);
    setMsg("");
    try {
      const q = new URLSearchParams({ from, to });
      const d = await opsFetch<GrowthDashboard>(`/api/ops/growth?${q}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      setData(d);
      setGoal(d.settings.monthlyNetGoalRub ? String(d.settings.monthlyNetGoalRub) : "");
      setFee(String(d.settings.paymentFeePct || 0));
      setGpu(String(d.settings.gpuDailyRub || 0));
      setMsg("Сохранено");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "ошибка");
    } finally {
      setSaving(false);
    }
  }

  async function togglePartner(id: string) {
    if (!data) return;
    const cur = new Set(data.settings.excludedPartnerIds);
    if (cur.has(id)) cur.delete(id);
    else cur.add(id);
    await save({ excludedPartnerIds: [...cur] });
  }

  const monthStart = `${today.slice(0, 8)}01`;
  const preset =
    from === addDays(today, -6) && to === today
      ? "7"
      : from === addDays(today, -29) && to === today
        ? "30"
        : from === monthStart && to === today
          ? "month"
          : data?.minYmd && from === data.minYmd && to === today
            ? "all"
            : "";

  return (
    <div className="flex flex-col gap-8">
      <header>
        <h1 className="font-display text-3xl">План прибыли</h1>
        <p className="mt-2 max-w-3xl text-sm text-zinc-400">
          Верх считает людей, которые впервые нажали /start в выбранные даты, и все их
          оплаты на сегодня. Низ — деньги, которые пришли в кассу в эти же даты. День
          считается по Москве. Роль «Партнёр» эту ссылку не открывает, в меню её нет.
        </p>
      </header>

      <div className="flex flex-wrap items-end gap-2">
        {(
          [
            ["7", "7 дней", addDays(today, -6), today],
            ["30", "30 дней", addDays(today, -29), today],
            ["month", "Этот месяц", monthStart, today],
            ["all", "Весь период", data?.minYmd || addDays(today, -29), today],
          ] as const
        ).map(([id, label, a, b]) => (
          <button
            key={id}
            type="button"
            className={
              preset === id
                ? "rounded-full bg-white/15 px-3 py-1.5 text-sm"
                : "rounded-full border border-white/15 px-3 py-1.5 text-sm text-zinc-400"
            }
            onClick={() => applyRange(a, b)}
          >
            {label}
          </button>
        ))}
        <label className="ml-2 text-xs text-zinc-500">
          с
          <input
            type="date"
            value={draftFrom}
            onChange={(e) => setDraftFrom(e.target.value)}
            className="ml-1 rounded-xl border border-white/10 bg-[#121214] px-2 py-1.5 text-sm text-[#f4f1ec]"
          />
        </label>
        <label className="text-xs text-zinc-500">
          по
          <input
            type="date"
            value={draftTo}
            onChange={(e) => setDraftTo(e.target.value)}
            className="ml-1 rounded-xl border border-white/10 bg-[#121214] px-2 py-1.5 text-sm text-[#f4f1ec]"
          />
        </label>
        <button
          type="button"
          className="rounded-full btn-grad px-4 py-1.5 text-sm"
          onClick={() => applyRange(draftFrom, draftTo)}
        >
          Показать
        </button>
        {loading ? <span className="text-xs text-zinc-500">Считаю…</span> : null}
      </div>

      {err ? <p className="text-sm text-red-400">{err}</p> : null}

      {data ? (
        <>
          <section className="flex flex-col gap-3">
            <h2 className="font-display text-xl">Кто пришёл {dayLabel(data.from)} — {dayLabel(data.to)}</h2>
            <p className="text-xs text-zinc-500">
              Первый депозит — человек из этих регистраций, который уже оплатил хотя бы раз.
              Повторный — его следующие оплаты. Чек — рубли на счёте, без бонуса на баланс.
              Доля партнёра берётся с зачисленной суммы, бонус в неё входит.
              Русский — язык Telegram, который начинается с ru. Если язык пустой, человек в долю не входит.
            </p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Metric label="Регистраций" value={num(data.cohort.regs)} hint={`${num(data.cohort.ownRegs)} своих · ${num(data.cohort.partnerRegs)} от партнёров`} />
              <Metric label="Первых депозитов, шт" value={num(data.cohort.firstPayers)} />
              <Metric label="Конверсия в первый депозит" value={pct(data.cohort.crFirst)} />
              <Metric label="Средний чек первого депозита" value={rub(data.cohort.avgCheckFirstRub)} />
              <Metric label="Повторных депозитов, шт" value={num(data.cohort.repeatPayments)} hint={`людей с повтором: ${num(data.cohort.repeatPayers)}`} />
              <Metric label="Конверсия в повторный депозит" value={pct(data.cohort.crRepeat)} hint="среди тех, кто уже платил" />
              <Metric label="Средний чек повторных депозитов" value={rub(data.cohort.avgCheckRepeatRub)} />
              <Metric
                label="Прибыль на одну регистрацию"
                value={rub(data.cohort.profitPerRegRub)}
                hint="выручка минус партнёр и платёжка, без карт. Карты снимаются с месяца целиком"
              />
              <Metric label="Доля русского от партнёров" value={ruLine(data.cohort.ruPartner)} />
              <Metric label="Доля русского у своих" value={ruLine(data.cohort.ruOwn)} />
              <Metric label="Выручка этих людей" value={rub(data.cohort.revenueRub)} />
              <Metric label="Осталось после партнёра, платёжки и карт" value={rub(data.cohort.netRub)} hint={`партнёрам ${rub(data.cohort.partnerRub)} · платёжка ${rub(data.cohort.feeRub)} · карты ${rub(data.cohort.gpuRub)}`} />
            </div>
          </section>

          <section className="rounded-2xl border border-white/10 p-4">
            <h2 className="font-display text-xl">Цель по деньгам</h2>
            <p className="mt-1 text-sm text-zinc-400">
              Сколько чистыми в месяц должно оставаться проекту. Норма дня = эта сумма / 30.
              Объём ниже пересчитан из ставок выбранного периода.
            </p>
            <form
              className="mt-4 flex flex-wrap items-end gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                void save({
                  monthlyNetGoalRub: parseNum(goal),
                  paymentFeePct: parseNum(fee),
                  gpuDailyRub: parseNum(gpu),
                });
              }}
            >
              <label className="text-xs text-zinc-500">
                Зарабатывать чистыми в месяц, ₽
                <input
                  value={goal}
                  onChange={(e) => setGoal(e.target.value)}
                  inputMode="numeric"
                  className="mt-1 block w-48 rounded-xl border border-white/10 bg-[#121214] px-3 py-2 text-sm text-[#f4f1ec]"
                />
              </label>
              <label className="text-xs text-zinc-500">
                Комиссия платёжки, %
                <input
                  value={fee}
                  onChange={(e) => setFee(e.target.value)}
                  inputMode="decimal"
                  className="mt-1 block w-28 rounded-xl border border-white/10 bg-[#121214] px-3 py-2 text-sm text-[#f4f1ec]"
                />
              </label>
              <label className="text-xs text-zinc-500">
                Карты и прочее, ₽ в день
                <input
                  value={gpu}
                  onChange={(e) => setGpu(e.target.value)}
                  inputMode="numeric"
                  className="mt-1 block w-36 rounded-xl border border-white/10 bg-[#121214] px-3 py-2 text-sm text-[#f4f1ec]"
                />
              </label>
              <button disabled={saving} className="rounded-full btn-grad px-4 py-2 text-sm disabled:opacity-50">
                Сохранить цель
              </button>
              {msg ? <span className="text-sm text-emerald-300">{msg}</span> : null}
            </form>
            <p className="mt-2 text-xs text-zinc-500">
              Платёжку оставьте 0, если её процент уже не сидит отдельно: бонус за способ оплаты
              попадает в зачисление и в долю партнёра. Карты тоже 0, пока не хотите держать их в цели.
            </p>

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl bg-white/5 p-4">
                <div className="text-[11px] uppercase text-zinc-500">Для этого нужна выручка в месяц</div>
                <div className="mt-1 text-2xl">{rub(data.plan.revenueNeedMonth)}</div>
                <p className="mt-1 text-xs text-zinc-500">
                  {data.plan.block === "no-goal"
                    ? "Сначала впишите цель."
                    : data.plan.block === "no-regs"
                      ? "В периоде нет регистраций, ставку снять не с чего."
                      : data.plan.block === "no-revenue"
                        ? "Эти люди ещё не платили, выручку из цели не посчитать."
                        : data.plan.block === "no-margin"
                          ? "После партнёра и платёжки с рубля ничего не остаётся."
                          : `С рубля выручки остаётся ${pct(data.plan.margin)}.`}
                </p>
              </div>
              <div className="rounded-2xl bg-white/5 p-4">
                <div className="text-[11px] uppercase text-zinc-500">Сейчас регистраций в день</div>
                <div className="mt-1 text-2xl">{num(data.plan.nowRegsPerDay, 1)}</div>
                <p className="mt-1 text-xs text-zinc-500">
                  своих {num(data.plan.nowOwnPerDay, 1)} · от партнёров {num(data.plan.nowPartnerPerDay, 1)}
                  {data.plan.blendedMonth != null && data.plan.nowRegsPerDay > 0
                    ? ` · до цели вместе нужно ${num(data.plan.blendedMonth / 30, 1)} в день (×${num((data.plan.blendedMonth / 30) / data.plan.nowRegsPerDay, 1)} к текущему)`
                    : ""}
                </p>
              </div>
            </div>

            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="text-[11px] uppercase text-zinc-500">
                  <tr>
                    <th className="py-2 pr-3 font-medium"> </th>
                    <th className="py-2 pr-3 font-medium">В месяц</th>
                    <th className="py-2 pr-3 font-medium">В неделю</th>
                    <th className="py-2 font-medium">В день</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-t border-white/10">
                    <td className="py-2 pr-3">Вместе, при текущей смеси</td>
                    <td className="py-2 pr-3">{people(data.plan.blendedMonth)}</td>
                    <td className="py-2 pr-3">{people(data.plan.blendedMonth == null ? null : (data.plan.blendedMonth * 7) / 30)}</td>
                    <td className="py-2">{people(data.plan.blendedMonth == null ? null : data.plan.blendedMonth / 30)}</td>
                  </tr>
                  <tr className="border-t border-white/10 text-zinc-400">
                    <td className="py-2 pr-3">из них своих</td>
                    <td className="py-2 pr-3">{people(data.plan.ownOfBlendMonth)}</td>
                    <td className="py-2 pr-3">{people(data.plan.ownOfBlendMonth == null ? null : (data.plan.ownOfBlendMonth * 7) / 30)}</td>
                    <td className="py-2">{people(data.plan.ownOfBlendMonth == null ? null : data.plan.ownOfBlendMonth / 30)}</td>
                  </tr>
                  <tr className="border-t border-white/10 text-zinc-400">
                    <td className="py-2 pr-3">из них от партнёров</td>
                    <td className="py-2 pr-3">{people(data.plan.partnerOfBlendMonth)}</td>
                    <td className="py-2 pr-3">{people(data.plan.partnerOfBlendMonth == null ? null : (data.plan.partnerOfBlendMonth * 7) / 30)}</td>
                    <td className="py-2">{people(data.plan.partnerOfBlendMonth == null ? null : data.plan.partnerOfBlendMonth / 30)}</td>
                  </tr>
                  <tr className="border-t border-white/10">
                    <td className="py-2 pr-3">Только своими, без партнёров</td>
                    <td className="py-2 pr-3">{people(data.plan.ownOnlyMonth)}</td>
                    <td className="py-2 pr-3">{people(data.plan.ownOnlyMonth == null ? null : (data.plan.ownOnlyMonth * 7) / 30)}</td>
                    <td className="py-2">{people(data.plan.ownOnlyMonth == null ? null : data.plan.ownOnlyMonth / 30)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            {data.plan.ownBlock === "no-own" ? (
              <p className="mt-2 text-xs text-zinc-500">Своих регистраций в периоде нет, отдельный путь без партнёров не посчитать.</p>
            ) : null}
            {data.plan.ownBlock === "own-no-margin" ? (
              <p className="mt-2 text-xs text-zinc-500">Свои регистрации сейчас не оставляют плюс после платёжки.</p>
            ) : null}
            {data.plan.ownProfitPerRegRub != null ? (
              <p className="mt-2 text-xs text-zinc-500">
                С одной своей регистрации остаётся {rub(data.plan.ownProfitPerRegRub)}, со смешанной — {rub(data.plan.profitPerRegRub)}.
              </p>
            ) : null}
          </section>

          <section>
            <h2 className="font-display text-xl">Партнёры по трафику</h2>
            <p className="mt-1 max-w-3xl text-sm text-zinc-400">
              Снимите галочку у тех, кто льёт чужой язык: они выпадут из ставок, из нормы регистраций
              и из кассы по дням. В списке останутся, чтобы вернуть одним щелчком.
              {data.excluded.partners > 0
                ? ` Сейчас в стороне ${data.excluded.partners}: ${num(data.excluded.regs)} регистраций, русский ${ruLine(data.excluded.ru)}, их выручка ${rub(data.excluded.revenueRub)}, в кассе периода ${rub(data.excluded.cashRub)}.`
                : ""}
            </p>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[860px] text-left text-sm">
                <thead className="text-[11px] uppercase text-zinc-500">
                  <tr>
                    <th className="py-2 pr-3 font-medium">Считать</th>
                    <th className="py-2 pr-3 font-medium">Кто</th>
                    <th className="py-2 pr-3 font-medium">Регистрации</th>
                    <th className="py-2 pr-3 font-medium">Русский</th>
                    <th className="py-2 pr-3 font-medium">Языки</th>
                    <th className="py-2 pr-3 font-medium">Оплатили</th>
                    <th className="py-2 pr-3 font-medium">Выручка</th>
                    <th className="py-2 pr-3 font-medium">Партнёру</th>
                    <th className="py-2 font-medium">Нам</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-t border-white/10">
                    <td className="py-2 pr-3 text-zinc-500">да</td>
                    <td className="py-2 pr-3">Свои, без партнёра</td>
                    <td className="py-2 pr-3">{num(data.own.regs)}</td>
                    <td className="py-2 pr-3">{ruLine(data.own.ru)}</td>
                    <td className="py-2 pr-3 text-zinc-400">{langLine(data.own.ru)}</td>
                    <td className="py-2 pr-3">{num(data.own.payers)}</td>
                    <td className="py-2 pr-3">{rub(data.own.revenueRub)}</td>
                    <td className="py-2 pr-3">{rub(data.own.partnerRub)}</td>
                    <td className="py-2">{rub(data.own.netRub)}</td>
                  </tr>
                  {data.partners.map((p) => (
                    <tr key={p.id} className={p.excluded ? "border-t border-white/10 text-zinc-500" : "border-t border-white/10"}>
                      <td className="py-2 pr-3">
                        <input
                          type="checkbox"
                          checked={!p.excluded}
                          disabled={saving}
                          aria-label={`Считать ${p.code}`}
                          onChange={() => void togglePartner(p.id)}
                        />
                      </td>
                      <td className="py-2 pr-3">
                        <div>{p.name || p.code}</div>
                        <div className="text-[11px] text-zinc-500">
                          {p.code} · {p.commissionPct}%{p.status !== "active" ? " · не активен" : ""}
                          {p.ruThin ? " · мало русского" : ""}
                        </div>
                      </td>
                      <td className="py-2 pr-3">{num(p.regs)}</td>
                      <td className="py-2 pr-3">{ruLine(p.ru)}</td>
                      <td className="py-2 pr-3 text-zinc-400">{langLine(p.ru)}</td>
                      <td className="py-2 pr-3">{num(p.payers)}</td>
                      <td className="py-2 pr-3">{rub(p.revenueRub)}</td>
                      <td className="py-2 pr-3">{rub(p.partnerRub)}</td>
                      <td className="py-2">{rub(p.netRub)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section>
            <h2 className="font-display text-xl">Касса по дням</h2>
            <p className="mt-1 text-sm text-zinc-400">
              Выручка — оплаты этого дня. Партнёрам — начисления этого дня. Наша доля — разница
              {data.settings.paymentFeePct > 0 ? `, минус ${num(data.settings.paymentFeePct, 1)}% платёжки` : ""}
              {data.settings.gpuDailyRub > 0 ? `, минус ${rub(data.settings.gpuDailyRub)} карт` : ""}.
              Эффективность — наша доля против дневной нормы. Отставание копится с начала периода.
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-4">
              <Metric label="Сделано выручки" value={rub(data.cash.revenueRub)} />
              <Metric label="Доля партнёрам" value={rub(data.cash.partnerRub)} />
              <Metric label="Наша доля" value={rub(data.cash.netRub)} />
              <Metric
                label="Эффективность к цели"
                value={gapText(data.cash.gapDays)}
                hint={data.cash.normRub == null ? "Цель ещё не задана" : `норма на эти дни ${rub(data.cash.normRub)}`}
              />
            </div>
            <div className="mt-3 max-h-[480px] overflow-auto">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="sticky top-0 bg-[#070708] text-[11px] uppercase text-zinc-500">
                  <tr>
                    <th className="py-2 pr-3 font-medium">День</th>
                    <th className="py-2 pr-3 font-medium">Сделано выручки</th>
                    <th className="py-2 pr-3 font-medium">Доля партнёрам</th>
                    <th className="py-2 pr-3 font-medium">Наша доля</th>
                    <th className="py-2 pr-3 font-medium">Накоплено</th>
                    <th className="py-2 pr-3 font-medium">К норме дня</th>
                    <th className="py-2 font-medium">К цели</th>
                  </tr>
                </thead>
                <tbody>
                  {data.dayRows.map((row) => (
                    <tr key={row.ymd} className="border-t border-white/10">
                      <td className="py-1.5 pr-3">{dayLabel(row.ymd)}</td>
                      <td className="py-1.5 pr-3">{rub(row.revenueRub)}</td>
                      <td className="py-1.5 pr-3">{rub(row.partnerRub)}</td>
                      <td className="py-1.5 pr-3">{rub(row.netRub)}</td>
                      <td className="py-1.5 pr-3">{rub(row.cumNetRub)}</td>
                      <td className="py-1.5 pr-3">
                        {row.pacePct == null ? "—" : `${Math.round(row.pacePct).toLocaleString("ru-RU")}%`}
                      </td>
                      <td className={row.gapDays != null && row.gapDays > 0.05 ? "py-1.5 text-red-400" : "py-1.5 text-emerald-300"}>
                        {gapText(row.gapDays)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : loading ? (
        <p className="text-sm text-zinc-500">Считаю…</p>
      ) : null}
    </div>
  );
}
