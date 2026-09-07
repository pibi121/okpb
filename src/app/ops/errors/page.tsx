"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { fmtTime, opsFetch } from "@/lib/ops/ops-fetch";

type Row = {
  id: string;
  kind: string;
  title: string;
  sampleMessage: string;
  sampleStack: string;
  count: number;
  status: string;
  lastAt: string;
  lastUserId: string;
  stage: string;
  timelineJson: string;
  lastJobId: string;
  lastRefType: string;
  lastRefId: string;
  buildVersion: string;
  autoRetryCount: number;
  lastMetaJson: string;
  cursorPrompt: string;
};

type TimelineEvent = { at: string; stage: string; detail?: string };

function parseTimeline(raw: string): TimelineEvent[] {
  try {
    const v = JSON.parse(raw || "[]");
    return Array.isArray(v) ? (v as TimelineEvent[]) : [];
  } catch {
    return [];
  }
}

export default function OpsErrorsPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [copied, setCopied] = useState("");
  const [msg, setMsg] = useState("");
  const [filter, setFilter] = useState("open");

  async function load() {
    const d = await opsFetch<{ rows: Row[] }>(`/api/ops/errors?status=${filter}`);
    setRows(d.rows);
  }

  useEffect(() => {
    void load().catch((e) => setMsg(e instanceof Error ? e.message : "ошибка"));
    const t = setInterval(() => void load().catch(() => undefined), 15000);
    return () => clearInterval(t);
  }, [filter]);

  async function setStatus(id: string, status: string) {
    await opsFetch("/api/ops/errors", {
      method: "POST",
      body: JSON.stringify({ id, status }),
    });
    await load();
  }

  async function autoRetry(id: string) {
    setMsg("");
    try {
      const r = await opsFetch<{ message: string }>("/api/ops/errors", {
        method: "POST",
        body: JSON.stringify({ id, action: "auto_retry" }),
      });
      setMsg(r.message);
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "не удалось повторить");
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="font-display text-3xl">Ошибки</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Карточка на каждый тип сбоя. «Скопировать полный лог» — вставьте мне в чат для фикса.
        </p>
      </div>
      {copied ? <p className="text-sm text-emerald-300">{copied}</p> : null}
      {msg ? <p className="text-sm text-peach">{msg}</p> : null}

      <div className="flex flex-wrap gap-2 text-sm">
        {(["open", "fixing", "done", "all"] as const).map((f) => (
          <button
            key={f}
            className={`rounded-full px-3 py-1 ${
              filter === f ? "btn-grad" : "border border-white/15"
            }`}
            onClick={() => setFilter(f)}
          >
            {f === "open"
              ? "Открытые"
              : f === "fixing"
                ? "Чиним"
                : f === "done"
                  ? "Починенные"
                  : "Все"}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-3">
        {rows.map((r) => {
          const timeline = parseTimeline(r.timelineJson);
          return (
            <div key={r.id} className="rounded-2xl border border-white/10 p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="font-medium">
                  {r.kind} · {r.title}
                </div>
                <div className="text-xs text-zinc-500">
                  {r.count} раз · {fmtTime(r.lastAt)}
                  {r.autoRetryCount ? ` · авто×${r.autoRetryCount}` : ""}
                </div>
              </div>
              <div className="mt-1 flex flex-wrap gap-2 text-xs text-zinc-500">
                {r.stage ? <span>этап: {r.stage}</span> : null}
                {r.buildVersion ? <span>билд: {r.buildVersion}</span> : null}
                {r.lastRefType ? (
                  <span>
                    ref: {r.lastRefType}/{r.lastRefId || "—"}
                  </span>
                ) : null}
                {r.lastJobId ? <span>job: {r.lastJobId}</span> : null}
                {r.lastUserId ? (
                  <Link
                    href={`/ops/users/${r.lastUserId}`}
                    className="text-peach hover:underline"
                  >
                    пользователь
                  </Link>
                ) : null}
              </div>
              <pre className="mt-2 max-h-28 overflow-auto whitespace-pre-wrap text-xs text-zinc-400">
                {r.sampleMessage}
              </pre>
              {timeline.length ? (
                <div className="mt-2 rounded-xl border border-white/8 bg-black/20 p-2 text-xs text-zinc-400">
                  <div className="mb-1 text-[10px] uppercase tracking-widest text-zinc-500">
                    Этапы
                  </div>
                  <ul className="space-y-0.5">
                    {timeline.slice(-8).map((e, i) => (
                      <li key={`${e.at}-${i}`}>
                        {fmtTime(e.at)} · {e.stage}
                        {e.detail ? ` — ${e.detail}` : ""}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <div className="mt-3 flex flex-wrap gap-2 text-xs">
                <button
                  className="rounded-full btn-grad px-3 py-1"
                  onClick={async () => {
                    await navigator.clipboard.writeText(r.cursorPrompt);
                    setCopied("Полный лог скопирован — вставьте в чат Курсора");
                  }}
                >
                  Скопировать полный лог
                </button>
                {(r.lastRefType === "quickVideoRun" || r.lastRefType === "galleryItem") &&
                r.lastRefId ? (
                  <button
                    className="rounded-full border border-white/15 px-3 py-1"
                    onClick={() => void autoRetry(r.id)}
                  >
                    Перегенерировать
                  </button>
                ) : null}
                <button
                  className="rounded-full border border-white/15 px-3 py-1"
                  onClick={() => void setStatus(r.id, "fixing")}
                >
                  Чиним
                </button>
                <button
                  className="rounded-full border border-white/15 px-3 py-1"
                  onClick={() => void setStatus(r.id, "done")}
                >
                  Починили
                </button>
                <button
                  className="rounded-full border border-white/15 px-3 py-1"
                  onClick={() => void setStatus(r.id, "open")}
                >
                  Снова открыть
                </button>
              </div>
            </div>
          );
        })}
        {!rows.length ? <p className="text-zinc-500">По этому фильтру пусто.</p> : null}
      </div>
    </div>
  );
}
