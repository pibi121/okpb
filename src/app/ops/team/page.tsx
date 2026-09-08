"use client";

import { useEffect, useState } from "react";
import { fmtTime, opsFetch } from "@/lib/ops/ops-fetch";

type Staff = {
  id: string;
  email: string;
  login: string;
  name: string | null;
  adminNotes: string;
  roleLabel: string;
  adminRole: string;
};
type Audit = {
  id: string;
  actorId: string;
  action: string;
  targetId: string;
  createdAt: string;
};
type RoleOpt = { id: string; label: string };

export default function OpsTeamPage() {
  const [staff, setStaff] = useState<Staff[]>([]);
  const [audit, setAudit] = useState<Audit[]>([]);
  const [roles, setRoles] = useState<RoleOpt[]>([]);
  const [msg, setMsg] = useState("");
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [note, setNote] = useState("");
  const [role, setRole] = useState("partner");
  const [issued, setIssued] = useState<{
    login: string;
    password: string;
  } | null>(null);

  async function load() {
    const d = await opsFetch<{
      staff: Staff[];
      audit: Audit[];
      roles: RoleOpt[];
    }>("/api/ops/team");
    setStaff(d.staff);
    setAudit(d.audit);
    setRoles(d.roles || []);
  }

  useEffect(() => {
    void load().catch((e) => setMsg(e instanceof Error ? e.message : "ошибка"));
  }, []);

  async function generateCreds() {
    const d = await opsFetch<{ login: string; password: string }>(
      "/api/ops/team",
      {
        method: "POST",
        body: JSON.stringify({ action: "generate" }),
      },
    );
    setLogin(d.login);
    setPassword(d.password);
    setIssued(null);
    setMsg("Логин и пароль сгенерированы — можно править или сразу выдать");
  }

  async function copyText(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setMsg("Скопировано");
    } catch {
      setMsg("Не удалось скопировать — выдели вручную");
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-display text-3xl">Команда</h1>
      <p className="text-sm text-zinc-500">
        Хозяин видит всё. Поддержка — люди и ошибки. Контент — тексты и шаблоны.
        Разработка — очередь и лаборатория. Партнёр — деньги/продажи, ссылки с
        UTM и статистика по людям и каждой ссылке.
      </p>
      {msg ? <p className="text-sm text-emerald-300">{msg}</p> : null}

      <section className="rounded-2xl border border-white/10 p-4">
        <h2 className="text-[11px] uppercase tracking-widest text-peach">
          Выдать доступ
        </h2>
        <p className="mt-1 text-xs text-zinc-500">
          Без почты: сгенерируй логин и пароль, укажи в заметке кто это, выбери
          роль и передай человеку данные для входа в /ops/login.
        </p>

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-full border border-white/15 px-4 py-2 text-sm text-zinc-200 hover:bg-white/5"
            onClick={() => void generateCreds().catch((e) => setMsg(e instanceof Error ? e.message : "ошибка"))}
          >
            Сгенерировать логин и пароль
          </button>
        </div>

        <form
          className="mt-3 grid gap-2 md:grid-cols-2"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              const res = await opsFetch<{
                created?: boolean;
                login?: string;
                password?: string;
                hint?: string;
              }>("/api/ops/team", {
                method: "POST",
                body: JSON.stringify({
                  login,
                  password,
                  note,
                  role,
                }),
              });
              if (res.created && res.login && res.password) {
                setIssued({ login: res.login, password: res.password });
                setMsg(res.hint || "Доступ создан");
              } else {
                setIssued(null);
                setMsg("Роль / заметка обновлены");
              }
              await load();
            } catch (err) {
              setMsg(err instanceof Error ? err.message : "ошибка");
            }
          }}
        >
          <label className="flex flex-col gap-1 text-xs text-zinc-400">
            Логин
            <input
              value={login}
              onChange={(e) => setLogin(e.target.value)}
              placeholder="например p_a1b2c3d4"
              className="rounded-xl border border-white/10 bg-[#121214] px-3 py-2 text-sm text-zinc-100"
              required
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-zinc-400">
            Пароль
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="сгенерируй или впиши свой"
              className="rounded-xl border border-white/10 bg-[#121214] px-3 py-2 text-sm text-zinc-100"
              required
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-zinc-400 md:col-span-2">
            Заметка (кто это)
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Иван · YouTube канал X"
              className="rounded-xl border border-white/10 bg-[#121214] px-3 py-2 text-sm text-zinc-100"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-zinc-400">
            Роль
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="rounded-xl border border-white/10 bg-[#121214] px-3 py-2 text-sm text-zinc-100"
            >
              {(roles.length
                ? roles
                : [
                    { id: "partner", label: "Партнёр" },
                    { id: "support", label: "Поддержка" },
                    { id: "content", label: "Контент" },
                    { id: "developer", label: "Разработка" },
                    { id: "owner", label: "Хозяин" },
                  ]
              ).map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>
          <button className="rounded-full btn-grad px-4 py-2 text-sm self-end">
            Выдать доступ
          </button>
        </form>

        {issued ? (
          <div className="mt-4 rounded-2xl border border-peach/30 bg-peach/10 p-4">
            <p className="text-sm font-medium text-peach">
              Передай человеку (один раз):
            </p>
            <pre className="mt-2 whitespace-pre-wrap break-all rounded-xl bg-black/30 p-3 text-sm text-zinc-100">
              {`Логин: ${issued.login}\nПароль: ${issued.password}\nВход: /ops/login`}
            </pre>
            <button
              type="button"
              className="mt-2 rounded-full border border-white/15 px-4 py-2 text-sm"
              onClick={() =>
                void copyText(
                  `Логин: ${issued.login}\nПароль: ${issued.password}\nВход: /ops/login`,
                )
              }
            >
              Скопировать
            </button>
          </div>
        ) : null}
      </section>

      <ul className="text-sm">
        {staff.map((s) => (
          <li key={s.id} className="border-t border-white/8 py-2">
            <span className="text-zinc-200">
              {s.name || "—"} · {s.roleLabel}
            </span>
            <span className="ml-2 text-zinc-500">
              логин <code className="text-zinc-300">{s.login}</code>
            </span>
            {s.adminNotes ? (
              <div className="mt-0.5 text-xs text-zinc-500">{s.adminNotes}</div>
            ) : null}
          </li>
        ))}
      </ul>
      <section>
        <h2 className="text-[11px] uppercase tracking-widest text-peach">
          Последние действия
        </h2>
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
