"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { fmtMs, opsFetch } from "@/lib/ops/ops-fetch";

type Payload = {
  stats: {
    today: {
      users: number;
      peachesIn: number;
      photos: number;
      videos: number;
      trains: number;
      errors: number;
    };
    funnel: {
      users: number;
      confirmed: number;
      withCharacter: number;
      withJob: number;
      paid: number;
    };
    queue: {
      pendingGallery: number;
      busyVideo: number;
      stuckGallery: number;
      stuckVideo: number;
      training: number;
      gpu: { running: boolean; avgJobMs24h: number; runningForMs: number };
    };
    avgMs: { photo: number; video: number; lora: number };
    errorsOpen: number;
    maintenance: boolean;
    loadMode: boolean;
  };
  bot: { ok: boolean; username: string | null; detail: string };
  gpu: { ok: boolean; detail: string; running?: number; pending?: number };
  botUrl: string;
  settings: { maintenance: boolean; loadMode: boolean };
};

function Card({
  label,
  value,
  hint,
  danger,
}: {
  label: string;
  value: string | number;
  hint?: string;
  danger?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-[#121214] p-4">
      <div className="text-[11px] uppercase tracking-widest text-zinc-500">{label}</div>
      <div className={`mt-2 font-display text-2xl ${danger ? "text-coral" : ""}`}>{value}</div>
      {hint ? <div className="mt-1 text-xs text-zinc-500">{hint}</div> : null}
    </div>
  );
}

export default function OpsHomePage() {
  const [data, setData] = useState<Payload | null>(null);
  const [err, setErr] = useState("");

  async function load() {
    try {
      setData(await opsFetch<Payload>("/api/ops/stats"));
      setErr("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "ошибка");
    }
  }

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 12000);
    return () => clearInterval(t);
  }, []);

  if (err) return <p className="text-coral">{err}</p>;
  if (!data) return <p className="text-zinc-500">Считаю цифры…</p>;
  const s = data.stats;

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="font-display text-3xl">Сегодня</h1>
        <p className="mt-1 text-sm text-zinc-500">Обновляется само, раз в несколько секунд.</p>
      </div>

      <div className="flex flex-wrap gap-2 text-sm">
        <span
          className={`rounded-full px-3 py-1 ${data.bot.ok ? "bg-emerald-500/15 text-emerald-300" : "bg-coral/20 text-coral"}`}
        >
          Бот: {data.bot.ok ? `@${data.bot.username || "ок"}` : data.bot.detail}
        </span>
        <span
          className={`rounded-full px-3 py-1 ${data.gpu.ok ? "bg-emerald-500/15 text-emerald-300" : "bg-zinc-700 text-zinc-300"}`}
        >
          Видеокарта: {data.gpu.detail}
        </span>
        {s.maintenance ? (
          <span className="rounded-full bg-coral/20 px-3 py-1 text-coral">Техработы</span>
        ) : null}
        {s.loadMode ? (
          <span className="rounded-full bg-apricot/20 px-3 py-1 text-apricot">Нагрузка</span>
        ) : null}
        <a href={data.botUrl} className="rounded-full bg-white/5 px-3 py-1 text-zinc-400" target="_blank">
          Открыть бота
        </a>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Card label="Новые люди" value={s.today.users} />
        <Card
          label="Персики «оплат»"
          value={s.today.peachesIn}
          hint="Пока оплаты-заглушки — это не живые деньги"
        />
        <Card label="Фото сегодня" value={s.today.photos} />
        <Card label="Видео сегодня" value={s.today.videos} />
        <Card label="Обучений готово" value={s.today.trains} />
        <Card
          label="Открытые ошибки"
          value={s.errorsOpen}
          danger={s.errorsOpen > 0}
          hint={`${s.today.errors} новых сегодня`}
        />
      </div>

      <section>
        <h2 className="text-[11px] uppercase tracking-widest text-peach">Воронка</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-5">
          <Card label="Все в боте" value={s.funnel.users} />
          <Card label="Приняли правила" value={s.funnel.confirmed} />
          <Card label="Есть персонаж" value={s.funnel.withCharacter} />
          <Card label="Хоть одна работа" value={s.funnel.withJob} />
          <Card label="Хоть раз «платили»" value={s.funnel.paid} />
        </div>
      </section>

      <section>
        <h2 className="text-[11px] uppercase tracking-widest text-peach">Очередь</h2>
        <p className="mt-1 text-xs text-zinc-500">
          Полный пульс GPU и функций —{" "}
          <Link href="/ops/load" className="text-peach hover:underline">
            Нагрузка
          </Link>
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Card label="Ждут в галерее" value={s.queue.pendingGallery} />
          <Card label="Видео в работе" value={s.queue.busyVideo} />
          <Card
            label="Застряли"
            value={s.queue.stuckGallery + s.queue.stuckVideo}
            danger={s.queue.stuckGallery + s.queue.stuckVideo > 0}
          />
          <Card
            label="Среднее время"
            value={fmtMs(s.avgMs.video || s.avgMs.photo)}
            hint={`фото ${fmtMs(s.avgMs.photo)} · видео ${fmtMs(s.avgMs.video)} · обучение ${fmtMs(s.avgMs.lora)}`}
          />
        </div>
        <div className="mt-4 flex gap-3 text-sm">
          <Link href="/ops/queue" className="text-peach hover:underline">
            Очередь подробно
          </Link>
          <Link href="/ops/errors" className="text-peach hover:underline">
            Ошибки
          </Link>
          <Link href="/ops/users" className="text-peach hover:underline">
            Люди
          </Link>
        </div>
      </section>
    </div>
  );
}
