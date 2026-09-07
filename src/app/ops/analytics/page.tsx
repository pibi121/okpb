"use client";

import { useEffect, useState } from "react";
import { fmtTime, opsFetch } from "@/lib/ops/ops-fetch";

type FunnelRow = {
  key: string;
  title: string;
  detail: string;
  uniqueUsers: number;
};

type Summary = {
  days: number;
  usersTouched: number;
  funnel: FunnelRow[];
  topEvents: { key: string; title: string; count: number }[];
  sources: { kind: string; code: string; count: number }[];
  recent: {
    id: string;
    at: string;
    userId: string;
    eventKey: string;
    stepTitle: string;
    surface: string;
    sourceKind: string;
    sourceCode: string;
    dayIndex: number;
  }[];
};

export default function OpsAnalyticsPage() {
  const [days, setDays] = useState(7);
  const [sourceKind, setSourceKind] = useState("");
  const [sourceCode, setSourceCode] = useState("");
  const [userId, setUserId] = useState("");
  const [data, setData] = useState<Summary | null>(null);
  const [userReport, setUserReport] = useState("");
  const [msg, setMsg] = useState("");

  async function load() {
    const q = new URLSearchParams({
      mode: "summary",
      days: String(days),
      ...(sourceKind ? { sourceKind } : {}),
      ...(sourceCode ? { sourceCode } : {}),
    });
    const d = await opsFetch<Summary>(`/api/ops/analytics?${q}`);
    setData(d);
  }

  useEffect(() => {
    void load().catch((e) => setMsg(e instanceof Error ? e.message : "ошибка"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function exportUrl(mode: string, format: string, extra?: Record<string, string>) {
    const q = new URLSearchParams({
      mode,
      format,
      days: String(days),
      ...(sourceKind ? { sourceKind } : {}),
      ...(sourceCode ? { sourceCode } : {}),
      ...(extra || {}),
    });
    return `/api/ops/analytics?${q}`;
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="font-display text-3xl">Аналитика воронки</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Каждый клик и экран с понятным названием — готово к выгрузке в ИИ для разбора аудитории и узких мест.
        </p>
      </div>
      {msg ? <p className="text-sm text-rose-300">{msg}</p> : null}

      <div className="flex flex-wrap items-end gap-2 rounded-2xl border border-white/10 p-4">
        <label className="text-xs text-zinc-500">
          Дней
          <input
            type="number"
            min={1}
            max={90}
            value={days}
            onChange={(e) => setDays(Number(e.target.value) || 7)}
            className="mt-1 block w-20 rounded-xl border border-white/10 bg-[#121214] px-3 py-2 text-sm"
          />
        </label>
        <label className="text-xs text-zinc-500">
          Источник (traffic/partner/organic)
          <input
            value={sourceKind}
            onChange={(e) => setSourceKind(e.target.value)}
            placeholder="traffic"
            className="mt-1 block w-36 rounded-xl border border-white/10 bg-[#121214] px-3 py-2 text-sm"
          />
        </label>
        <label className="text-xs text-zinc-500">
          Код источника
          <input
            value={sourceCode}
            onChange={(e) => setSourceCode(e.target.value)}
            placeholder="m_instagram"
            className="mt-1 block w-40 rounded-xl border border-white/10 bg-[#121214] px-3 py-2 text-sm"
          />
        </label>
        <button
          type="button"
          className="rounded-full btn-grad px-4 py-2 text-sm"
          onClick={() =>
            void load().catch((e) => setMsg(e instanceof Error ? e.message : "ошибка"))
          }
        >
          Обновить
        </button>
        <a
          className="rounded-full border border-white/15 px-4 py-2 text-sm"
          href={exportUrl("export", "csv")}
          target="_blank"
          rel="noreferrer"
        >
          CSV всё
        </a>
        <a
          className="rounded-full border border-emerald-500/40 px-4 py-2 text-sm text-emerald-200"
          href={exportUrl("export", "ai")}
          target="_blank"
          rel="noreferrer"
        >
          TXT для ИИ
        </a>
        <a
          className="rounded-full border border-white/15 px-4 py-2 text-sm"
          href={exportUrl("catalog", "json")}
          target="_blank"
          rel="noreferrer"
        >
          Каталог шагов
        </a>
      </div>

      {data ? (
        <>
          <p className="text-sm text-zinc-400">
            За {data.days} дн. касались воронки: <b className="text-white">{data.usersTouched}</b> чел.
          </p>

          <section className="rounded-2xl border border-white/10 p-4">
            <h2 className="font-display text-xl">Ключевые этапы (уникальные люди)</h2>
            <p className="mt-1 text-xs text-zinc-500">
              Сравни числа сверху вниз — где отвал, туда и правим воронку.
            </p>
            <ul className="mt-3 space-y-3">
              {data.funnel.map((f, i) => (
                <li key={f.key} className="border-t border-white/8 pt-3 first:border-0 first:pt-0">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-sm text-zinc-200">
                      {i + 1}. {f.title}
                    </span>
                    <span className="font-mono text-lg text-peach">{f.uniqueUsers}</span>
                  </div>
                  <p className="mt-0.5 text-xs text-zinc-500">{f.detail}</p>
                  <p className="mt-0.5 font-mono text-[10px] text-zinc-600">{f.key}</p>
                </li>
              ))}
            </ul>
          </section>

          <div className="grid gap-4 md:grid-cols-2">
            <section className="rounded-2xl border border-white/10 p-4">
              <h2 className="text-lg">Топ кликов</h2>
              <ul className="mt-2 max-h-80 space-y-1 overflow-auto text-sm">
                {data.topEvents.map((e) => (
                  <li key={e.key} className="flex justify-between gap-2 border-t border-white/5 py-1">
                    <span className="text-zinc-300">{e.title}</span>
                    <span className="shrink-0 font-mono text-zinc-500">{e.count}</span>
                  </li>
                ))}
              </ul>
            </section>
            <section className="rounded-2xl border border-white/10 p-4">
              <h2 className="text-lg">Источники трафика</h2>
              <ul className="mt-2 max-h-80 space-y-1 overflow-auto text-sm">
                {data.sources.map((s) => (
                  <li
                    key={`${s.kind}:${s.code}`}
                    className="flex justify-between gap-2 border-t border-white/5 py-1"
                  >
                    <span className="text-zinc-300">
                      {s.kind}
                      {s.code ? ` / ${s.code}` : ""}
                    </span>
                    <span className="font-mono text-zinc-500">{s.count}</span>
                  </li>
                ))}
              </ul>
            </section>
          </div>

          <section className="rounded-2xl border border-white/10 p-4">
            <h2 className="text-lg">Разбор одного человека (для ИИ)</h2>
            <div className="mt-2 flex flex-wrap gap-2">
              <input
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                placeholder="userId из ops/users"
                className="min-w-[220px] flex-1 rounded-xl border border-white/10 bg-[#121214] px-3 py-2 text-sm"
              />
              <button
                type="button"
                className="rounded-full border border-white/15 px-4 py-2 text-sm"
                onClick={async () => {
                  if (!userId.trim()) return;
                  try {
                    const d = await opsFetch<{ aiReport: string }>(
                      `/api/ops/analytics?mode=user&userId=${encodeURIComponent(userId.trim())}`,
                    );
                    setUserReport(d.aiReport);
                    setMsg("Отчёт по пользователю готов");
                  } catch (e) {
                    setMsg(e instanceof Error ? e.message : "ошибка");
                  }
                }}
              >
                Показать таймлайн
              </button>
              <a
                className="rounded-full border border-emerald-500/40 px-4 py-2 text-sm text-emerald-200"
                href={
                  userId.trim()
                    ? exportUrl("user", "ai", { userId: userId.trim() })
                    : "#"
                }
                target="_blank"
                rel="noreferrer"
                onClick={(e) => {
                  if (!userId.trim()) e.preventDefault();
                }}
              >
                Скачать TXT
              </a>
              <a
                className="rounded-full border border-white/15 px-4 py-2 text-sm"
                href={
                  userId.trim()
                    ? exportUrl("user", "csv", { userId: userId.trim() })
                    : "#"
                }
                target="_blank"
                rel="noreferrer"
                onClick={(e) => {
                  if (!userId.trim()) e.preventDefault();
                }}
              >
                CSV
              </a>
            </div>
            {userReport ? (
              <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap rounded-xl bg-black/40 p-3 text-xs text-zinc-300">
                {userReport}
              </pre>
            ) : null}
          </section>

          <section className="rounded-2xl border border-white/10 p-4">
            <h2 className="text-lg">Последние события</h2>
            <ul className="mt-2 max-h-72 space-y-1 overflow-auto text-xs text-zinc-400">
              {data.recent.map((r) => (
                <li key={r.id} className="border-t border-white/5 py-1.5">
                  <span className="text-zinc-500">{fmtTime(r.at)}</span>
                  {" · "}
                  <button
                    type="button"
                    className="text-peach underline-offset-2 hover:underline"
                    onClick={() => setUserId(r.userId)}
                  >
                    {r.userId.slice(0, 8)}…
                  </button>
                  {" · "}
                  <span className="text-zinc-200">{r.stepTitle}</span>
                  <span className="text-zinc-600">
                    {" "}
                    (день{r.dayIndex}, {r.surface}
                    {r.sourceCode ? `, ${r.sourceKind}:${r.sourceCode}` : ""})
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </>
      ) : (
        <p className="text-sm text-zinc-500">Загрузка…</p>
      )}
    </div>
  );
}
