"use client";

import { useEffect, useState } from "react";
import { fmtTime, opsFetch } from "@/lib/ops/ops-fetch";

type Row = {
  id: string;
  username: string;
  status: string;
  isPrimary: boolean;
  hasToken: boolean;
  telegramBotId: string | null;
  notes: string | null;
  activatedAt: string;
  retiredAt: string | null;
};

type Payload = {
  activeUrl: string;
  health: { ok: boolean; username: string | null; detail: string };
  botsHealth: Array<{
    id: string;
    username: string;
    isPrimary: boolean;
    ok: boolean;
    detail: string;
  }>;
  tokenSet: boolean;
  liveCount: number;
  rows: Row[];
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

  async function act(body: Record<string, unknown>) {
    setMsg("");
    try {
      const res = await opsFetch<{ message?: string; hint?: string; url?: string }>(
        "/api/ops/bot",
        { method: "POST", body: JSON.stringify(body) },
      );
      setMsg([res.message, res.hint, res.url].filter(Boolean).join(" — "));
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "ошибка");
    }
  }

  if (!d) return <p className="text-zinc-500">Смотрю бота…</p>;

  return (
    <div className="flex max-w-2xl flex-col gap-5">
      <div>
        <h1 className="font-display text-3xl">Боты (dual)</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Несколько токенов на одних данных. Primary для ссылки /bot; dual — параллельно, без остановки
          первого. Live: {d.liveCount}.
        </p>
      </div>

      <p className={`text-sm ${d.health.ok ? "text-emerald-300" : "text-coral"}`}>
        Env primary: {d.health.detail}
      </p>
      <p className="text-sm text-zinc-400">
        Публичная ссылка:{" "}
        <a className="text-peach" href={d.activeUrl} target="_blank">
          {d.activeUrl}
        </a>
      </p>
      <p className="text-sm text-zinc-500">
        Токен в env: {d.tokenSet ? "задан" : "нет"}. Токены dual хранятся зашифрованно в БД.
      </p>

      {d.botsHealth?.length ? (
        <ul className="rounded-2xl border border-white/10 bg-[#121214] p-3 text-sm">
          {d.botsHealth.map((b) => (
            <li key={b.id} className={b.ok ? "text-emerald-300" : "text-coral"}>
              @{b.username}
              {b.isPrimary ? " · primary" : " · dual"} — {b.detail}
            </li>
          ))}
        </ul>
      ) : null}

      <form
        className="flex flex-col gap-2 rounded-2xl border border-peach/30 bg-peach/5 p-4"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          void act({
            action: "add_dual",
            token: f.get("token"),
            notes: f.get("notes"),
            makePrimary: f.get("makePrimary") === "on",
          }).then(() => {
            e.currentTarget.reset();
          });
        }}
      >
        <div className="text-sm font-medium text-peach">Добавить dual-бота</div>
        <p className="text-xs text-zinc-500">
          Вставьте токен из BotFather. Старый бот и текущие генерации не останавливаем. Данные
          пользователей общие.
        </p>
        <input
          name="token"
          type="password"
          autoComplete="off"
          placeholder="123456:AA…"
          className="rounded-xl border border-white/10 bg-[#121214] px-3 py-2 text-sm"
          required
        />
        <input
          name="notes"
          placeholder="Заметка: зеркало / перестраховка"
          className="rounded-xl border border-white/10 bg-[#121214] px-3 py-2 text-sm"
        />
        <label className="flex items-center gap-2 text-xs text-zinc-400">
          <input type="checkbox" name="makePrimary" className="rounded" />
          Сразу сделать primary для /bot (polling старого всё равно продолжается)
        </label>
        <button className="rounded-full btn-grad px-4 py-2 text-sm">Добавить dual</button>
      </form>

      <form
        className="flex flex-col gap-2 rounded-2xl border border-white/10 p-4"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          void act({
            username: f.get("username"),
            notes: f.get("notes"),
          });
        }}
      >
        <div className="text-sm font-medium text-zinc-300">Только ссылка /bot (без токена)</div>
        <input
          name="username"
          placeholder="username_бота"
          className="rounded-xl border border-white/10 bg-[#121214] px-3 py-2 text-sm"
          required
        />
        <input
          name="notes"
          placeholder="Заметка"
          className="rounded-xl border border-white/10 bg-[#121214] px-3 py-2 text-sm"
        />
        <button className="rounded-full border border-white/15 px-4 py-2 text-sm">
          Сделать primary-ссылкой
        </button>
      </form>

      {msg ? <p className="text-sm text-emerald-300">{msg}</p> : null}

      <section>
        <h2 className="text-[11px] uppercase tracking-widest text-peach">Список</h2>
        <ul className="mt-2 space-y-2 text-sm">
          {d.rows.map((r) => (
            <li
              key={r.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/8 bg-[#121214] px-3 py-2"
            >
              <div>
                <div className="font-medium">
                  @{r.username}
                  {r.isPrimary ? (
                    <span className="ml-2 text-xs text-peach">primary</span>
                  ) : null}
                  <span className="ml-2 text-xs text-zinc-500">{r.status}</span>
                </div>
                <div className="text-xs text-zinc-500">
                  {r.hasToken ? "токен есть" : "без токена"} · {fmtTime(r.activatedAt)}
                  {r.notes ? ` · ${r.notes}` : ""}
                </div>
              </div>
              <div className="flex gap-1">
                {r.status === "active" && !r.isPrimary ? (
                  <button
                    className="rounded-full border border-white/15 px-2 py-0.5 text-[11px]"
                    onClick={() => void act({ action: "set_primary", id: r.id })}
                  >
                    Primary
                  </button>
                ) : null}
                {r.status === "active" && !r.isPrimary ? (
                  <button
                    className="rounded-full border border-coral/40 px-2 py-0.5 text-[11px] text-coral"
                    onClick={() => {
                      if (confirm(`Вывести @${r.username} из dual?`)) {
                        void act({ action: "retire", id: r.id });
                      }
                    }}
                  >
                    Retire
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
