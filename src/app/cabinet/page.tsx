"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { CabinetFrame } from "@/components/cabinet-frame";
import { cabinetFetch, payoutStatus, rub, when } from "@/lib/cabinet/browser";

type Home = {
  account: {
    id: string;
    login: string;
    name: string;
    role: string;
    balancePeaches: number;
    totalEarnedPeaches: number;
    holdPeaches: number;
    availablePeaches: number;
  };
  projects: Array<{
    id: string;
    counterpartName: string;
    myPct: number;
    investorPct: number;
    buyerPct: number;
    gross: number;
    myCommission: number;
    investedRub: number;
    reportedRub: number;
    openSpends: number;
  }>;
  accruals: Array<{
    id: string;
    counterpartName: string;
    linkLabel: string;
    gross: number;
    mine: number;
    other: number;
    reversed: boolean;
    createdAt: string;
  }>;
  withdrawals: Array<{
    id: string;
    amountPeaches: number;
    status: string;
    payoutDetails: string;
    createdAt: string;
  }>;
};

export default function CabinetHomePage() {
  const [home, setHome] = useState<Home | null>(null);
  const [needLogin, setNeedLogin] = useState(false);
  const [error, setError] = useState("");
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [amount, setAmount] = useState("");
  const [details, setDetails] = useState("");
  const [formMsg, setFormMsg] = useState("");

  const load = useCallback(async () => {
    const res = await fetch("/api/cabinet/home");
    if (res.status === 401) {
      setNeedLogin(true);
      setHome(null);
      return;
    }
    const data = (await res.json()) as Home & { error?: string };
    if (!res.ok) throw new Error(data.error || "ошибка");
    setNeedLogin(false);
    setHome(data);
  }, []);

  useEffect(() => {
    void load().catch((e) => setError(e instanceof Error ? e.message : "ошибка"));
  }, [load]);

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await cabinetFetch("/api/cabinet/login", {
        method: "POST",
        body: JSON.stringify({ login, password }),
      });
      setPassword("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "ошибка");
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    await cabinetFetch("/api/cabinet/logout", { method: "POST" });
    setHome(null);
    setNeedLogin(true);
  }

  async function withdraw(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFormMsg("");
    try {
      await cabinetFetch("/api/cabinet/home", {
        method: "POST",
        body: JSON.stringify({
          amountPeaches: Number(amount),
          payoutDetails: details,
        }),
      });
      setAmount("");
      setDetails("");
      setFormMsg("Заявка на вывод отправлена");
      await load();
    } catch (err) {
      setFormMsg(err instanceof Error ? err.message : "ошибка");
    } finally {
      setBusy(false);
    }
  }

  if (!home && !needLogin && !error) {
    return <p className="p-8 text-sm text-zinc-500">Открываю кабинет…</p>;
  }

  if (needLogin || !home) {
    return (
      <form
        onSubmit={signIn}
        className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-4 px-4"
      >
        <p className="text-[11px] uppercase tracking-[0.22em] text-peach">Кабинет сделки</p>
        <h1 className="font-display text-4xl">Вход</h1>
        <p className="text-sm text-zinc-500">
          Для инвестора и байера. Аккаунт создаёт администратор, сами зарегистрироваться нельзя.
        </p>
        <label className="flex flex-col gap-1 text-sm">
          Логин
          <input
            value={login}
            onChange={(e) => setLogin(e.target.value)}
            autoComplete="username"
            required
            className="rounded-xl border border-white/10 bg-[#121214] px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Пароль
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            type="password"
            autoComplete="current-password"
            required
            className="rounded-xl border border-white/10 bg-[#121214] px-3 py-2"
          />
        </label>
        {error ? <p className="text-sm text-coral">{error}</p> : null}
        <button
          type="submit"
          disabled={busy}
          className="rounded-full btn-grad px-4 py-2.5 text-sm disabled:opacity-60"
        >
          {busy ? "Входим…" : "Войти"}
        </button>
      </form>
    );
  }

  const otherWord = home.account.role === "investor" ? "Байер" : "Инвестор";

  return (
    <CabinetFrame
      name={home.account.name}
      role={home.account.role}
      balance={home.account.balancePeaches}
      onLogout={() => void signOut()}
    >
      <section className="flex flex-col gap-3">
        <h1 className="text-2xl">Проекты</h1>
        {home.projects.length === 0 ? (
          <p className="text-sm text-zinc-500">Пока нет ни одной связки.</p>
        ) : null}
        {home.projects.map((p) => (
          <Link
            key={p.id}
            href={`/cabinet/p/${p.id}`}
            className="rounded-2xl border border-white/10 p-4 hover:bg-white/5"
          >
            <div className="text-[11px] uppercase tracking-widest text-zinc-500">{otherWord}</div>
            <div className="mt-1 text-xl">{p.counterpartName}</div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-sm text-zinc-400 sm:grid-cols-4">
              <div>
                <div className="text-[11px] uppercase">Ваша доля</div>
                <div className="text-foreground">{p.myPct}%</div>
              </div>
              <div>
                <div className="text-[11px] uppercase">Вложено</div>
                <div className="text-foreground">{rub(p.investedRub)}</div>
              </div>
              <div>
                <div className="text-[11px] uppercase">Оборот</div>
                <div className="text-foreground">{rub(p.gross)}</div>
              </div>
              <div>
                <div className="text-[11px] uppercase">Ваша комиссия</div>
                <div className="text-foreground">{rub(p.myCommission)}</div>
              </div>
            </div>
            {p.openSpends > 0 ? (
              <p className="mt-3 text-sm text-peach">
                {p.openSpends}{" "}
                {home.account.role === "buyer" ? "без отчёта" : "ждут отчёт байера"}
              </p>
            ) : null}
          </Link>
        ))}
      </section>

      <section className="rounded-2xl border border-white/10 p-4">
        <h2 className="text-lg">Вывод</h2>
        <p className="mt-1 text-sm text-zinc-500">
          Минимум 500 ₽. Выводы раз в неделю, по воскресеньям. Можно несколько заявок. С
          начисления до заявки проходит 3 суток — холд платёжки.
        </p>
        <p className="mt-2 text-sm">
          Доступно сейчас: {rub(home.account.availablePeaches)}
          {home.account.holdPeaches > 0
            ? ` · на холде ${rub(home.account.holdPeaches)}`
            : ""}
          {" · всего начислено "}
          {rub(home.account.totalEarnedPeaches)}
        </p>
        <form onSubmit={withdraw} className="mt-3 flex flex-col gap-2">
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="numeric"
            placeholder="Сумма, ₽"
            className="rounded-xl border border-white/10 bg-[#121214] px-3 py-2 text-sm"
          />
          <textarea
            value={details}
            onChange={(e) => setDetails(e.target.value)}
            placeholder="Реквизиты: карта или USDT TRC20"
            className="min-h-20 rounded-xl border border-white/10 bg-[#121214] px-3 py-2 text-sm"
          />
          {formMsg ? <p className="text-sm text-zinc-300">{formMsg}</p> : null}
          <button
            type="submit"
            disabled={busy}
            className="rounded-full btn-grad px-4 py-2 text-sm disabled:opacity-60"
          >
            Запросить вывод
          </button>
        </form>
        {home.withdrawals.length > 0 ? (
          <ul className="mt-4 flex flex-col gap-2 text-sm">
            {home.withdrawals.map((w) => (
              <li key={w.id} className="rounded-xl bg-white/5 px-3 py-2">
                <b>{rub(w.amountPeaches)}</b> · {payoutStatus(w.status)} · {when(w.createdAt)}
                <div className="text-zinc-500">{w.payoutDetails}</div>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section>
        <h2 className="text-lg">Начисления</h2>
        {home.accruals.length === 0 ? (
          <p className="mt-2 text-sm text-zinc-500">Пополнений по вашим проектам ещё не было.</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-2 text-sm">
            {home.accruals.map((a) => (
              <li key={a.id} className="rounded-xl border border-white/10 px-3 py-2">
                <div>
                  {a.reversed ? "возврат · " : ""}
                  {when(a.createdAt)} · {a.counterpartName} · {a.linkLabel}
                </div>
                <div className="text-zinc-400">
                  пополнение {rub(a.gross)} · вам {rub(a.mine)} · второй стороне {rub(a.other)}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </CabinetFrame>
  );
}
