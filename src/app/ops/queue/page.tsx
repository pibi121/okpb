"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { fmtMs, fmtTime, opsFetch } from "@/lib/ops/ops-fetch";

type Payload = {
  queue: {
    gpu: { running: boolean; runningForMs: number; avgJobMs24h: number };
    maintenance: boolean;
    loadMode: boolean;
    pending: Array<{
      id: string;
      kind: string;
      title: string | null;
      stuck: boolean;
      createdAt: string;
      user: { name: string | null; email: string };
    }>;
    videos: Array<{
      id: string;
      title: string;
      status: string;
      error: string | null;
      stuck: boolean;
      createdAt: string;
      userId: string;
      user: { name: string | null };
    }>;
  };
  gpu: { ok: boolean; detail: string; running?: number; pending?: number };
};

export default function OpsQueuePage() {
  const [data, setData] = useState<Payload | null>(null);
  const [msg, setMsg] = useState("");

  async function load() {
    setData(await opsFetch<Payload>("/api/ops/queue"));
  }

  useEffect(() => {
    void load().catch((e) => setMsg(e instanceof Error ? e.message : "ошибка"));
    const t = setInterval(() => void load().catch(() => undefined), 10000);
    return () => clearInterval(t);
  }, []);

  async function toggle(field: "maintenance" | "loadMode", value: boolean) {
    setMsg("");
    try {
      await opsFetch("/api/ops/queue", {
        method: "POST",
        body: JSON.stringify({ [field]: value }),
      });
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "нет прав на переключатель");
    }
  }

  if (!data) return <p className="text-zinc-500">Смотрю очередь…</p>;
  const q = data.queue;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-display text-3xl">Очередь и видеокарта</h1>
      {msg ? <p className="text-sm text-coral">{msg}</p> : null}
      <div className="flex flex-wrap gap-2 text-sm">
        <span className="rounded-full bg-white/5 px-3 py-1">
          GPU процесс: {q.gpu.running ? `занят ${fmtMs(q.gpu.runningForMs)}` : "свободен"}
        </span>
        <span className="rounded-full bg-white/5 px-3 py-1">{data.gpu.detail}</span>
        <span className="rounded-full bg-white/5 px-3 py-1">
          среднее {fmtMs(q.gpu.avgJobMs24h)}
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          className={`rounded-full px-4 py-1.5 text-sm ${q.maintenance ? "bg-coral/20 text-coral" : "border border-white/15"}`}
          onClick={() => void toggle("maintenance", !q.maintenance)}
        >
          {q.maintenance ? "Техработы включены" : "Включить техработы"}
        </button>
        <button
          className={`rounded-full px-4 py-1.5 text-sm ${q.loadMode ? "bg-apricot/20 text-apricot" : "border border-white/15"}`}
          onClick={() => void toggle("loadMode", !q.loadMode)}
        >
          {q.loadMode ? "Режим нагрузки" : "Включить «большая нагрузка»"}
        </button>
      </div>

      <section>
        <h2 className="text-[11px] uppercase tracking-widest text-peach">Видео</h2>
        <ul className="mt-2 text-sm">
          {q.videos.map((v) => (
            <li key={v.id} className="border-t border-white/8 py-2">
              {v.title} · {v.status}
              {v.stuck ? " · застряло" : ""} · {v.user.name} · {fmtTime(v.createdAt)}
              {v.status === "error" ? (
                <button
                  className="ml-2 text-peach"
                  onClick={() =>
                    opsFetch("/api/ops/jobs", {
                      method: "POST",
                      body: JSON.stringify({
                        action: "retry",
                        runId: v.id,
                        userId: v.userId,
                      }),
                    }).then(() => load())
                  }
                >
                  повторить
                </button>
              ) : null}
            </li>
          ))}
          {!q.videos.length ? <li className="text-zinc-500">Пусто</li> : null}
        </ul>
      </section>
      <section>
        <h2 className="text-[11px] uppercase tracking-widest text-peach">Галерея в ожидании</h2>
        <ul className="mt-2 text-sm">
          {q.pending.map((p) => (
            <li key={p.id} className="border-t border-white/8 py-2">
              {p.kind} · {p.title || p.id} {p.stuck ? "· застряло" : ""} ·{" "}
              <Link className="text-peach" href="/ops/jobs">
                работы
              </Link>
            </li>
          ))}
          {!q.pending.length ? <li className="text-zinc-500">Пусто</li> : null}
        </ul>
      </section>
    </div>
  );
}
