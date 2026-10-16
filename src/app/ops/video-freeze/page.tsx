"use client";

import { useEffect, useState } from "react";
import { opsFetch } from "@/lib/ops/ops-fetch";

type Payload = {
  videoFrozen: boolean;
  enableText: string;
  disableText: string;
};

export default function VideoFreezePage() {
  const [data, setData] = useState<Payload | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    setData(await opsFetch<Payload>("/api/ops/video-freeze"));
  }

  useEffect(() => {
    void load().catch((e) => setMsg(e instanceof Error ? e.message : "ошибка"));
  }, []);

  async function run(action: "on" | "off") {
    const question =
      action === "on"
        ? "Заморозить видео? Оплата за ролики в очереди вернётся, и сообщение уйдёт только этим людям. Фото останется."
        : "Снова включить видео и написать тем, кто был в очереди или пытался запустить ролик?";
    if (!confirm(question)) return;
    setBusy(true);
    setMsg("");
    try {
      const result = await opsFetch<{ refunded?: number; notified?: number }>(
        "/api/ops/video-freeze",
        { method: "POST", body: JSON.stringify({ action }) },
      );
      if (action === "on") {
        setMsg(
          `Видео заморожено. Закрыто роликов: ${result.refunded ?? 0}. Сообщение ушло ${result.notified ?? 0} людям из очереди.`,
        );
      } else {
        setMsg(
          `Видео снова можно запускать. О возвращении написали ${result.notified ?? 0} людям.`,
        );
      }
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "не удалось");
    } finally {
      setBusy(false);
    }
  }

  if (!data) return <p className="text-zinc-500">Смотрю режим…</p>;

  return (
    <div className="flex max-w-2xl flex-col gap-5">
      <div>
        <h1 className="font-display text-3xl">Заморозка видео</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Фото остаётся. Новые ролики не запускаются: человеку приходит это сообщение. Уже идущие закрываются с возвратом оплаты, и текст уходит только им.
        </p>
      </div>
      {msg ? <p className="text-sm text-emerald-300">{msg}</p> : null}
      <p className="text-sm">
        Сейчас:{" "}
        <span className={data.videoFrozen ? "text-coral" : "text-emerald-300"}>
          {data.videoFrozen ? "видео заморожено" : "видео работает"}
        </span>
      </p>
      {data.videoFrozen ? (
        <button
          type="button"
          disabled={busy}
          className="w-fit rounded-full bg-emerald-500/30 px-4 py-2 text-sm text-emerald-200 disabled:opacity-50"
          onClick={() => void run("off")}
        >
          Включить видео обратно
        </button>
      ) : (
        <button
          type="button"
          disabled={busy}
          className="w-fit rounded-full bg-coral/20 px-4 py-2 text-sm text-coral disabled:opacity-50"
          onClick={() => void run("on")}
        >
          Заморозить видео
        </button>
      )}
      <section className="rounded-2xl border border-white/10 p-4">
        <h2 className="text-[11px] uppercase tracking-widest text-peach">
          Сообщение при заморозке
        </h2>
        <pre className="mt-2 whitespace-pre-wrap text-sm text-zinc-300">
          {data.enableText}
        </pre>
      </section>
      <section className="rounded-2xl border border-white/10 p-4">
        <h2 className="text-[11px] uppercase tracking-widest text-peach">
          Сообщение, когда видео снова включено
        </h2>
        <pre className="mt-2 whitespace-pre-wrap text-sm text-zinc-300">
          {data.disableText}
        </pre>
        <p className="mt-3 text-xs text-zinc-500">
          Бонус из текста заморозки здесь не начисляется. Сумму нужно задать отдельно.
        </p>
      </section>
    </div>
  );
}
