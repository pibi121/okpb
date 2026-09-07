"use client";

import { useEffect, useState } from "react";
import { fmtTime, opsFetch } from "@/lib/ops/ops-fetch";

type Payload = {
  activeUrl: string;
  health: { ok: boolean; username: string | null; detail: string };
  tokenSet: boolean;
  rows: Array<{
    id: string;
    username: string;
    status: string;
    notes: string | null;
    activatedAt: string;
  }>;
};

export default function OpsBotPage() {
  const [d, setD] = useState<Payload | null>(null);
  const [msg, setMsg] = useState("");

  async function load() {
    setD(await opsFetch<Payload>("/api/ops/bot"));
  }

  useEffect(() => {
    void load().catch((e) => setMsg(e instanceof Error ? e.message : "ошибка"));
  }, []);

  if (!d) return <p className="text-zinc-500">Смотрю бота…</p>;

  return (
    <div className="flex max-w-xl flex-col gap-5">
      <h1 className="font-display text-3xl">Бот</h1>
      <p className={`text-sm ${d.health.ok ? "text-emerald-300" : "text-coral"}`}>{d.health.detail}</p>
      <p className="text-sm text-zinc-400">
        Живая ссылка:{" "}
        <a className="text-peach" href={d.activeUrl} target="_blank">
          {d.activeUrl}
        </a>
      </p>
      <p className="text-sm text-zinc-500">
        Токен в env: {d.tokenSet ? "задан" : "нет"}. Сам токен здесь не показываем.
      </p>
      <ol className="list-decimal space-y-1 pl-5 text-sm text-zinc-400">
        <li>Создайте нового бота в BotFather.</li>
        <li>Впишите username ниже — сайт /bot сразу начнёт вести туда.</li>
        <li>Положите новый токен в TELEGRAM_BOT_TOKEN на сервере и перезапустите.</li>
        <li>Закрепите ссылку в канале.</li>
      </ol>
      <form
        className="flex flex-col gap-2 rounded-2xl border border-white/10 p-4"
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const res = await opsFetch<{ url: string; hint: string }>("/api/ops/bot", {
            method: "POST",
            body: JSON.stringify({
              username: f.get("username"),
              notes: f.get("notes"),
            }),
          });
          setMsg(`${res.url}. ${res.hint}`);
          await load();
        }}
      >
        <input name="username" placeholder="новое_имя_бота" className="rounded-xl border border-white/10 bg-[#121214] px-3 py-2 text-sm" required />
        <input name="notes" placeholder="Заметка: забанили 6 сен" className="rounded-xl border border-white/10 bg-[#121214] px-3 py-2 text-sm" />
        <button className="rounded-full btn-grad px-4 py-2 text-sm">Сделать основным</button>
      </form>
      {msg ? <p className="text-sm text-emerald-300">{msg}</p> : null}
      <ul className="text-sm text-zinc-400">
        {d.rows.map((r) => (
          <li key={r.id}>
            @{r.username} · {r.status} · {fmtTime(r.activatedAt)}
          </li>
        ))}
      </ul>
    </div>
  );
}
