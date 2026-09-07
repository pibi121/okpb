"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { fmtTime, opsFetch } from "@/lib/ops/ops-fetch";

type UserPayload = {
  user: {
    id: string;
    name: string | null;
    email: string;
    locale: string;
    balancePeaches: number;
    blocked: boolean;
    blockReason: string;
    adminNotes: string;
    adminRole: string;
    createdAt: string;
    ageConfirmed: boolean;
    source: string;
    trafficLink: { code: string; label: string } | null;
    platformAccounts: Array<{
      platformUserId: string;
      username: string | null;
      lastSeenAt: string;
      chatState: string;
    }>;
    characters: Array<{ id: string; name: string; loraStatus: string; photoCount: number }>;
    ledger: Array<{ id: string; amount: number; reason: string; createdAt: string }>;
    galleryItems: Array<{
      id: string;
      kind: string;
      title: string | null;
      resultUrl: string;
      status: string;
      error: string | null;
      createdAt: string;
    }>;
  };
};

export default function OpsUserCardPage() {
  const params = useParams<{ id: string }>();
  const [data, setData] = useState<UserPayload["user"] | null>(null);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");

  async function load() {
    const d = await opsFetch<UserPayload>(`/api/ops/users/${params.id}`);
    setData(d.user);
  }

  useEffect(() => {
    load().catch((e) => setErr(e instanceof Error ? e.message : "ошибка"));
  }, [params.id]);

  async function act(action: string, extra: Record<string, unknown> = {}) {
    setMsg("");
    try {
      await opsFetch(`/api/ops/users/${params.id}`, {
        method: "POST",
        body: JSON.stringify({ action, ...extra }),
      });
      await load();
      setMsg("Сохранено");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "ошибка");
    }
  }

  if (err && !data) return <p className="text-coral">{err}</p>;
  if (!data) return <p className="text-zinc-500">Открываю карточку…</p>;
  const tg = data.platformAccounts[0];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/ops/users" className="text-sm text-zinc-500 hover:text-peach">
          ← К списку
        </Link>
        <h1 className="mt-2 font-display text-3xl">{data.name || "Без имени"}</h1>
        <p className="text-sm text-zinc-500">
          {tg ? `@${tg.username || tg.platformUserId}` : data.email} · {data.locale} · баланс{" "}
          <b>{data.balancePeaches}</b> 🍑
          {data.blocked ? " · заблокирован" : ""}
        </p>
      </div>
      {msg ? <p className="text-sm text-emerald-300">{msg}</p> : null}
      {err ? <p className="text-sm text-coral">{err}</p> : null}

      <div className="grid gap-4 md:grid-cols-2">
        <form
          className="rounded-2xl border border-white/10 p-4"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void act("credit", {
              amount: Number(f.get("amount")),
              reason: String(f.get("reason") || ""),
            });
          }}
        >
          <h2 className="text-sm font-medium">Начислить персики</h2>
          <input name="amount" type="number" min={1} className="mt-2 w-full rounded-xl border border-white/10 bg-[#121214] px-3 py-2 text-sm" />
          <input name="reason" placeholder="Почему" className="mt-2 w-full rounded-xl border border-white/10 bg-[#121214] px-3 py-2 text-sm" />
          <button className="mt-3 rounded-full btn-grad px-4 py-1.5 text-sm">Начислить</button>
        </form>
        <form
          className="rounded-2xl border border-white/10 p-4"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void act("debit", {
              amount: Number(f.get("amount")),
              reason: String(f.get("reason") || ""),
            });
          }}
        >
          <h2 className="text-sm font-medium">Списать</h2>
          <input name="amount" type="number" min={1} className="mt-2 w-full rounded-xl border border-white/10 bg-[#121214] px-3 py-2 text-sm" />
          <input name="reason" placeholder="Почему" className="mt-2 w-full rounded-xl border border-white/10 bg-[#121214] px-3 py-2 text-sm" />
          <button className="mt-3 rounded-full border border-white/15 px-4 py-1.5 text-sm">Списать</button>
        </form>
      </div>

      <div className="flex flex-wrap gap-2">
        {data.blocked ? (
          <button className="rounded-full bg-white/10 px-4 py-1.5 text-sm" onClick={() => void act("unblock")}>
            Разблокировать
          </button>
        ) : (
          <button
            className="rounded-full bg-coral/20 px-4 py-1.5 text-sm text-coral"
            onClick={() => {
              const reason = prompt("Почему блок?") || "";
              void act("block", { reason });
            }}
          >
            Заблокировать
          </button>
        )}
      </div>

      <form
        className="rounded-2xl border border-white/10 p-4"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          void act("message", { text: String(f.get("text") || "") });
        }}
      >
        <h2 className="text-sm font-medium">Написать в бот</h2>
        <textarea name="text" rows={3} className="mt-2 w-full rounded-xl border border-white/10 bg-[#121214] px-3 py-2 text-sm" />
        <button className="mt-3 rounded-full btn-grad px-4 py-1.5 text-sm">Отправить</button>
      </form>

      <form
        className="rounded-2xl border border-white/10 p-4"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          void act("note", { note: String(f.get("note") || "") });
        }}
      >
        <h2 className="text-sm font-medium">Заметка</h2>
        <textarea
          name="note"
          defaultValue={data.adminNotes}
          rows={3}
          className="mt-2 w-full rounded-xl border border-white/10 bg-[#121214] px-3 py-2 text-sm"
        />
        <button className="mt-3 rounded-full border border-white/15 px-4 py-1.5 text-sm">Сохранить заметку</button>
      </form>

      <p className="text-sm text-zinc-500">
        Правила 18+: {data.ageConfirmed ? "да" : "нет"} · источник: {data.trafficLink?.label || data.source} ·
        шаг в боте: {tg?.chatState || "—"} · был: {fmtTime(tg?.lastSeenAt)}
        {data.blockReason ? ` · блок: ${data.blockReason}` : ""}
      </p>

      <section>
        <h2 className="text-[11px] uppercase tracking-widest text-peach">Персонажи</h2>
        <ul className="mt-2 text-sm text-zinc-400">
          {data.characters.map((c) => (
            <li key={c.id}>
              {c.name} · {c.loraStatus} · фото {c.photoCount}
            </li>
          ))}
          {!data.characters.length ? <li>Нет</li> : null}
        </ul>
      </section>

      <section>
        <h2 className="text-[11px] uppercase tracking-widest text-peach">Работы</h2>
        <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
          {data.galleryItems.map((g) => (
            <div key={g.id} className="overflow-hidden rounded-xl border border-white/10">
              {g.kind !== "photo" ? (
                <video src={g.resultUrl} className="h-32 w-full object-cover" muted />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={g.resultUrl} alt="" className="h-32 w-full object-cover" />
              )}
              <div className="px-2 py-1 text-[11px] text-zinc-500">
                {g.status} {g.error ? `· ${g.error}` : ""}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-[11px] uppercase tracking-widest text-peach">Движение персиков</h2>
        <ul className="mt-2 text-sm text-zinc-400">
          {data.ledger.map((l) => (
            <li key={l.id}>
              {l.amount > 0 ? "+" : ""}
              {l.amount} · {l.reason} · {fmtTime(l.createdAt)}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
