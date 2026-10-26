"use client";

import { useEffect, useState } from "react";
import { opsFetch } from "@/lib/ops/ops-fetch";
import { rub, when } from "@/lib/cabinet/browser";

type Account = {
  id: string;
  login: string;
  name: string;
  role: string;
  balancePeaches: number;
  totalEarnedPeaches: number;
};
type Project = {
  id: string;
  investorPct: number;
  buyerPct: number;
  chatUrl: string;
  investor: { id: string; name: string; login: string };
  buyer: { id: string; name: string; login: string };
  links: Array<{ id: string; label: string; purchases: number; purchaseGrossPeaches: number }>;
  spends: Array<{ id: string; amountRub: number; reportTitle: string; reportedAt: string | null; createdAt: string }>;
};
type Withdrawal = {
  id: string;
  amountPeaches: number;
  payoutDetails: string;
  createdAt: string;
  account: { name: string; login: string; role: string };
};
type Payload = { accounts: Account[]; projects: Project[]; withdrawals: Withdrawal[] };

export default function OpsDealsPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [msg, setMsg] = useState("");
  const [issued, setIssued] = useState<{ login: string; password: string } | null>(null);
  const [name, setName] = useState("");
  const [role, setRole] = useState("investor");
  const [investorId, setInvestorId] = useState("");
  const [buyerId, setBuyerId] = useState("");
  const [chatUrl, setChatUrl] = useState("");
  const [drafts, setDrafts] = useState<Record<string, { investorPct: string; buyerPct: string; chatUrl: string }>>({});

  async function load() {
    const next = await opsFetch<Payload>("/api/ops/deals");
    setData(next);
    const d: typeof drafts = {};
    for (const p of next.projects) {
      d[p.id] = {
        investorPct: String(p.investorPct),
        buyerPct: String(p.buyerPct),
        chatUrl: p.chatUrl,
      };
    }
    setDrafts(d);
  }

  useEffect(() => {
    void load().catch((e) => setMsg(e instanceof Error ? e.message : "ошибка"));
  }, []);

  async function createAccount(e: React.FormEvent) {
    e.preventDefault();
    setMsg("");
    try {
      const created = await opsFetch<{ login: string; password: string }>("/api/ops/deals", {
        method: "POST",
        body: JSON.stringify({ action: "create_account", role, name }),
      });
      setIssued(created);
      setName("");
      await load();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "ошибка");
    }
  }

  async function resetPassword(id: string) {
    setMsg("");
    try {
      const created = await opsFetch<{ login: string; password: string }>("/api/ops/deals", {
        method: "POST",
        body: JSON.stringify({ action: "reset_password", id }),
      });
      setIssued(created);
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "ошибка");
    }
  }

  async function createProject(e: React.FormEvent) {
    e.preventDefault();
    setMsg("");
    try {
      await opsFetch("/api/ops/deals", {
        method: "POST",
        body: JSON.stringify({ action: "create_project", investorId, buyerId, chatUrl }),
      });
      setChatUrl("");
      setMsg("Связка создана");
      await load();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "ошибка");
    }
  }

  async function saveProject(id: string) {
    const d = drafts[id];
    if (!d) return;
    setMsg("");
    try {
      await opsFetch("/api/ops/deals", {
        method: "POST",
        body: JSON.stringify({
          action: "update_project",
          id,
          investorPct: Number(d.investorPct),
          buyerPct: Number(d.buyerPct),
          chatUrl: d.chatUrl,
        }),
      });
      setMsg("Связка сохранена. Новые доли — на следующие пополнения.");
      await load();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "ошибка");
    }
  }

  async function credit(linkId: string, form: FormData) {
    setMsg("");
    try {
      const result = await opsFetch<{ gross: number; investorPeaches: number; buyerPeaches: number }>(
        "/api/ops/deals",
        {
          method: "POST",
          body: JSON.stringify({
            action: "credit",
            linkId,
            gross: Number(form.get("gross")),
            mature: form.get("mature") === "on",
          }),
        },
      );
      setMsg(
        `Пополнение ${result.gross}₽: инвестору ${result.investorPeaches}₽, байеру ${result.buyerPeaches}₽`,
      );
      await load();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "ошибка");
    }
  }

  async function review(id: string, action: "approve" | "reject") {
    setMsg("");
    try {
      await opsFetch("/api/ops/deals", {
        method: "POST",
        body: JSON.stringify({ action, id }),
      });
      await load();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "ошибка");
    }
  }

  const investors = data?.accounts.filter((a) => a.role === "investor") || [];
  const buyers = data?.accounts.filter((a) => a.role === "buyer") || [];

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-8 px-4 py-6">
      <div>
        <h1 className="text-2xl">Сделки</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Кабинеты инвесторов и байеров. Человек сам аккаунт не создаёт. Пароль показывается один
          раз.
        </p>
      </div>
      {msg ? <p className="text-sm text-zinc-300">{msg}</p> : null}
      {issued ? (
        <div className="rounded-2xl border border-peach/40 bg-peach/10 p-4 text-sm">
          <div>Логин: <b>{issued.login}</b></div>
          <div>Пароль: <b>{issued.password}</b></div>
          <p className="mt-1 text-zinc-400">Скопируйте и передайте человеку. Повторно пароль не показывается.</p>
        </div>
      ) : null}

      <section>
        <h2 className="text-[11px] uppercase tracking-widest text-peach">Новый человек</h2>
        <form onSubmit={createAccount} className="mt-3 flex flex-wrap items-end gap-2">
          <label className="text-sm">
            Имя
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="mt-1 block rounded-lg border border-white/15 bg-black/30 px-2 py-1"
            />
          </label>
          <label className="text-sm">
            Роль
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="mt-1 block rounded-lg border border-white/15 bg-black/30 px-2 py-1"
            >
              <option value="investor">Инвестор</option>
              <option value="buyer">Байер</option>
            </select>
          </label>
          <button type="submit" className="rounded-lg bg-peach/20 px-3 py-1.5 text-sm text-peach">
            Создать и показать пароль
          </button>
        </form>
        <ul className="mt-4 flex flex-col gap-2 text-sm">
          {(data?.accounts || []).map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 px-3 py-2">
              <span>
                {a.role === "investor" ? "Инвестор" : "Байер"} · {a.name || a.login} ·{" "}
                <code>{a.login}</code> · баланс {rub(a.balancePeaches)}
              </span>
              <button type="button" className="text-peach" onClick={() => void resetPassword(a.id)}>
                Новый пароль
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="text-[11px] uppercase tracking-widest text-peach">Новая связка</h2>
        <form onSubmit={createProject} className="mt-3 flex flex-col gap-2 text-sm">
          <label>
            Инвестор
            <select
              value={investorId}
              onChange={(e) => setInvestorId(e.target.value)}
              required
              className="mt-1 block w-full rounded-lg border border-white/15 bg-black/30 px-2 py-1"
            >
              <option value="">Выберите</option>
              {investors.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({a.login})
                </option>
              ))}
            </select>
          </label>
          <label>
            Байер
            <select
              value={buyerId}
              onChange={(e) => setBuyerId(e.target.value)}
              required
              className="mt-1 block w-full rounded-lg border border-white/15 bg-black/30 px-2 py-1"
            >
              <option value="">Выберите</option>
              {buyers.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({a.login})
                </option>
              ))}
            </select>
          </label>
          <label>
            Ссылка на чат
            <input
              value={chatUrl}
              onChange={(e) => setChatUrl(e.target.value)}
              placeholder="https://t.me/..."
              className="mt-1 block w-full rounded-lg border border-white/15 bg-black/30 px-2 py-1"
            />
          </label>
          <button type="submit" className="w-fit rounded-lg bg-peach/20 px-3 py-1.5 text-peach">
            Создать связку
          </button>
        </form>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-[11px] uppercase tracking-widest text-peach">Связки и доли</h2>
        {(data?.projects || []).map((p) => {
          const d = drafts[p.id];
          return (
            <article key={p.id} className="rounded-2xl border border-white/10 p-4 text-sm">
              <div className="text-base">
                {p.investor.name || p.investor.login} → {p.buyer.name || p.buyer.login}
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                <label>
                  Инвестору, %
                  <input
                    value={d?.investorPct || ""}
                    onChange={(e) =>
                      setDrafts((prev) => ({ ...prev, [p.id]: { ...prev[p.id]!, investorPct: e.target.value } }))
                    }
                    className="mt-1 block w-full rounded-lg border border-white/15 bg-black/30 px-2 py-1"
                  />
                </label>
                <label>
                  Байеру, %
                  <input
                    value={d?.buyerPct || ""}
                    onChange={(e) =>
                      setDrafts((prev) => ({ ...prev, [p.id]: { ...prev[p.id]!, buyerPct: e.target.value } }))
                    }
                    className="mt-1 block w-full rounded-lg border border-white/15 bg-black/30 px-2 py-1"
                  />
                </label>
                <label className="sm:col-span-1">
                  Чат
                  <input
                    value={d?.chatUrl || ""}
                    onChange={(e) =>
                      setDrafts((prev) => ({ ...prev, [p.id]: { ...prev[p.id]!, chatUrl: e.target.value } }))
                    }
                    className="mt-1 block w-full rounded-lg border border-white/15 bg-black/30 px-2 py-1"
                  />
                </label>
              </div>
              <button type="button" className="mt-2 text-peach" onClick={() => void saveProject(p.id)}>
                Сохранить долю и чат
              </button>
              <ul className="mt-3 text-zinc-400">
                {p.spends.map((s) => (
                  <li key={s.id}>
                    {rub(s.amountRub)} · {when(s.createdAt)} · {s.reportedAt ? s.reportTitle || "отчёт есть" : "ждёт отчёт"}
                  </li>
                ))}
                {p.spends.length === 0 ? <li>Расходов ещё нет</li> : null}
              </ul>
              <div className="mt-3 flex flex-col gap-2">
                {p.links.map((l) => (
                  <form
                    key={l.id}
                    className="flex flex-wrap items-center gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void credit(l.id, new FormData(e.currentTarget));
                    }}
                  >
                    <span>
                      {l.label}: {l.purchases} пополн. / {rub(l.purchaseGrossPeaches)}
                    </span>
                    <input
                      name="gross"
                      inputMode="numeric"
                      placeholder="Пополнение, ₽"
                      className="w-36 rounded-lg border border-white/15 bg-black/30 px-2 py-1"
                    />
                    <label className="text-xs text-zinc-400">
                      <input name="mature" type="checkbox" className="mr-1" />
                      холд 3 суток уже прошёл
                    </label>
                    <button type="submit" className="text-peach">
                      Начислить
                    </button>
                  </form>
                ))}
                {p.links.length === 0 ? (
                  <p className="text-zinc-500">Байер ещё не создал ссылку — начислять пока некуда.</p>
                ) : null}
              </div>
            </article>
          );
        })}
      </section>

      <section>
        <h2 className="text-[11px] uppercase tracking-widest text-peach">Заявки на вывод</h2>
        <p className="mt-1 text-xs text-zinc-500">В общий чат партнёров эти заявки не уходят.</p>
        {(data?.withdrawals || []).length === 0 ? <p className="mt-2 text-sm text-zinc-500">Пусто</p> : null}
        {(data?.withdrawals || []).map((w) => (
          <div key={w.id} className="mt-3 rounded-2xl border border-white/10 p-4 text-sm">
            <div>
              {w.account.role === "investor" ? "Инвестор" : "Байер"} {w.account.name} ·{" "}
              <b>{rub(w.amountPeaches)}</b> · {when(w.createdAt)}
            </div>
            <div className="text-zinc-500">{w.payoutDetails}</div>
            <div className="mt-2 flex gap-3">
              <button type="button" className="text-peach" onClick={() => void review(w.id, "approve")}>
                Выплатил
              </button>
              <button type="button" onClick={() => void review(w.id, "reject")}>
                Отклонить
              </button>
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
