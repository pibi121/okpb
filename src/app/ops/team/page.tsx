"use client";

import { useEffect, useState } from "react";
import { fmtTime, opsFetch } from "@/lib/ops/ops-fetch";

type Staff = { id: string; email: string; name: string | null; roleLabel: string; adminRole: string };
type Audit = { id: string; actorId: string; action: string; targetId: string; createdAt: string };

export default function OpsTeamPage() {
  const [staff, setStaff] = useState<Staff[]>([]);
  const [audit, setAudit] = useState<Audit[]>([]);
  const [msg, setMsg] = useState("");

  async function load() {
    const d = await opsFetch<{ staff: Staff[]; audit: Audit[] }>("/api/ops/team");
    setStaff(d.staff);
    setAudit(d.audit);
  }

  useEffect(() => {
    void load().catch((e) => setMsg(e instanceof Error ? e.message : "ошибка"));
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-display text-3xl">Команда</h1>
      <p className="text-sm text-zinc-500">
        Хозяин видит всё. Поддержка — люди и ошибки. Контент — тексты и шаблоны. Разработка — очередь и лаборатория.
      </p>
      {msg ? <p className="text-sm text-emerald-300">{msg}</p> : null}
      <form
        className="grid gap-2 rounded-2xl border border-white/10 p-4 md:grid-cols-3"
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const res = await opsFetch<{ created?: boolean; password?: string; hint?: string }>(
            "/api/ops/team",
            {
              method: "POST",
              body: JSON.stringify({
                email: f.get("email"),
                name: f.get("name"),
                role: f.get("role"),
              }),
            },
          );
          setMsg(
            res.created && res.password
              ? `Создан. Пароль один раз: ${res.password}`
              : "Роль обновлена",
          );
          await load();
        }}
      >
        <input name="email" type="email" placeholder="почта" className="rounded-xl border border-white/10 bg-[#121214] px-3 py-2 text-sm" required />
        <input name="name" placeholder="имя" className="rounded-xl border border-white/10 bg-[#121214] px-3 py-2 text-sm" />
        <select name="role" className="rounded-xl border border-white/10 bg-[#121214] px-3 py-2 text-sm">
          <option value="support">Поддержка</option>
          <option value="content">Контент</option>
          <option value="developer">Разработка</option>
          <option value="owner">Хозяин</option>
        </select>
        <button className="rounded-full btn-grad px-4 py-2 text-sm md:col-span-3">Выдать доступ</button>
      </form>
      <ul className="text-sm">
        {staff.map((s) => (
          <li key={s.id} className="border-t border-white/8 py-2">
            {s.name} · {s.email} · {s.roleLabel}
          </li>
        ))}
      </ul>
      <section>
        <h2 className="text-[11px] uppercase tracking-widest text-peach">Последние действия</h2>
        <ul className="mt-2 text-xs text-zinc-500">
          {audit.map((a) => (
            <li key={a.id}>
              {fmtTime(a.createdAt)} · {a.action} · {a.targetId}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
