"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { CabinetFrame } from "@/components/cabinet-frame";
import { cabinetFetch, rub, when } from "@/lib/cabinet/browser";

type View = {
  account: {
    name: string;
    role: string;
    balancePeaches: number;
    availablePeaches: number;
  };
  project: {
    id: string;
    chatUrl: string;
    investorPct: number;
    buyerPct: number;
    myPct: number;
    counterpartName: string;
    investedRub: number;
    reportedRub: number;
    gross: number;
    myCommission: number;
    referrals: number;
    purchases: number;
  };
  links: Array<{
    id: string;
    label: string;
    clicks: number;
    signups: number;
    purchases: number;
    purchaseGrossPeaches: number;
    myCommission: number;
    bridgeUrl: string;
    telegramUrl: string;
  }>;
  spends: Array<{
    id: string;
    amountRub: number;
    reportTitle: string;
    reportBody: string;
    hasFile: boolean;
    reportedAt: string | null;
    createdAt: string;
  }>;
  accruals: Array<{
    id: string;
    linkLabel: string;
    gross: number;
    mine: number;
    other: number;
    reversed: boolean;
    createdAt: string;
  }>;
};

export default function CabinetProjectPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");

  const load = useCallback(async () => {
    const res = await fetch(`/api/cabinet/project/${id}`);
    if (res.status === 401) {
      router.replace("/cabinet");
      return;
    }
    const data = (await res.json()) as View & { error?: string };
    if (!res.ok) throw new Error(data.error || "ошибка");
    setView(data);
  }, [id, router]);

  useEffect(() => {
    void load().catch((e) => setError(e instanceof Error ? e.message : "ошибка"));
  }, [load]);

  async function signOut() {
    await cabinetFetch("/api/cabinet/logout", { method: "POST" });
    router.replace("/cabinet");
  }

  async function copy(text: string) {
    await navigator.clipboard.writeText(text);
    setMsg("Ссылка скопирована");
  }

  async function createLink(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg("");
    try {
      await cabinetFetch(`/api/cabinet/project/${id}`, {
        method: "POST",
        body: JSON.stringify({ action: "create_link", label }),
      });
      setLabel("");
      setMsg("Ссылка создана");
      await load();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "ошибка");
    } finally {
      setBusy(false);
    }
  }

  async function createSpend(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg("");
    try {
      await cabinetFetch(`/api/cabinet/project/${id}`, {
        method: "POST",
        body: JSON.stringify({ action: "create_spend", amountRub: Number(amount) }),
      });
      setAmount("");
      setMsg("Сумма записана. Байер приложит отчёт.");
      await load();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "ошибка");
    } finally {
      setBusy(false);
    }
  }

  async function saveReport(spendId: string, form: FormData) {
    setBusy(true);
    setMsg("");
    form.set("spendId", spendId);
    try {
      await cabinetFetch(`/api/cabinet/project/${id}/report`, { method: "POST", body: form });
      setMsg("Отчёт сохранён");
      await load();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "ошибка");
    } finally {
      setBusy(false);
    }
  }

  if (error) return <p className="p-8 text-sm text-coral">{error}</p>;
  if (!view) return <p className="p-8 text-sm text-zinc-500">Открываю проект…</p>;

  const investor = view.account.role === "investor";
  const waiting = view.project.investedRub - view.project.reportedRub;

  return (
    <CabinetFrame
      name={view.account.name}
      role={view.account.role}
      balance={view.account.balancePeaches}
      onLogout={() => void signOut()}
    >
      <div>
        <Link href="/cabinet" className="text-sm text-zinc-500">
          ← Все проекты
        </Link>
        <p className="mt-3 text-[11px] uppercase tracking-widest text-zinc-500">
          {investor ? "Байер" : "Инвестор"}
        </p>
        <h1 className="text-3xl">{view.project.counterpartName}</h1>
        <p className="mt-2 text-sm text-zinc-400">
          Инвестору {view.project.investorPct}% · байеру {view.project.buyerPct}%. Новая доля
          действует на следующие пополнения.
        </p>
        {view.project.chatUrl ? (
          <a
            href={view.project.chatUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-block rounded-full bg-white/10 px-4 py-2 text-sm"
          >
            Общий чат
          </a>
        ) : (
          <p className="mt-3 text-sm text-zinc-500">Чат ещё не закреплён. Его добавляют в админке.</p>
        )}
      </div>

      <section className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
        <Stat label="Вложено" value={rub(view.project.investedRub)} />
        <Stat label="С отчётом" value={rub(view.project.reportedRub)} />
        <Stat label="Ждёт отчёт" value={rub(waiting)} />
        <Stat label="Регистрации" value={String(view.project.referrals)} />
        <Stat label="Пополнения" value={String(view.project.purchases)} />
        <Stat label="Оборот" value={rub(view.project.gross)} />
        <Stat label="Ваша комиссия" value={rub(view.project.myCommission)} />
        <Stat label="Доступно к заявке" value={rub(view.account.availablePeaches)} />
      </section>

      {msg ? <p className="text-sm text-zinc-300">{msg}</p> : null}

      {investor ? (
        <form onSubmit={createSpend} className="rounded-2xl border border-white/10 p-4">
          <h2 className="text-lg">Я отправил деньги</h2>
          <p className="mt-1 text-sm text-zinc-500">
            Это учёт. Сумма прибавляется к инвестиции в этого байера. Куда она ушла, напишет байер.
          </p>
          <div className="mt-3 flex gap-2">
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="numeric"
              placeholder="Сумма, ₽"
              className="flex-1 rounded-xl border border-white/10 bg-[#121214] px-3 py-2 text-sm"
            />
            <button
              type="submit"
              disabled={busy}
              className="rounded-full btn-grad px-4 py-2 text-sm disabled:opacity-60"
            >
              Записать
            </button>
          </div>
        </form>
      ) : null}

      <section className="flex flex-col gap-3">
        <h2 className="text-lg">Куда ушли деньги</h2>
        {view.spends.length === 0 ? (
          <p className="text-sm text-zinc-500">Записей пока нет.</p>
        ) : null}
        {view.spends.map((s) => (
          <article key={s.id} className="rounded-2xl border border-white/10 p-4 text-sm">
            <div className="flex items-baseline justify-between gap-2">
              <b>{rub(s.amountRub)}</b>
              <span className="text-zinc-500">{when(s.createdAt)}</span>
            </div>
            {s.reportedAt ? (
              <div className="mt-2">
                <div>{s.reportTitle}</div>
                <p className="mt-1 whitespace-pre-wrap text-zinc-400">{s.reportBody}</p>
                {s.hasFile ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={`/api/cabinet/file/${s.id}`}
                    alt="Скрин отчёта"
                    className="mt-3 max-h-80 rounded-xl border border-white/10"
                  />
                ) : null}
              </div>
            ) : (
              <p className="mt-2 text-zinc-500">Отчёта ещё нет.</p>
            )}
            {!investor ? (
              <ReportForm busy={busy} spend={s} onSubmit={(form) => void saveReport(s.id, form)} />
            ) : null}
          </article>
        ))}
      </section>

      <section>
        <h2 className="text-lg">Ссылки</h2>
        <p className="mt-1 text-sm text-zinc-500">
          У каждой ссылки два адреса, оба ведут в одну сделку. Переходник на сайте всегда
          открывает текущего бота. Прямая сразу открывает бота. Переходы и регистрации
          считаются, когда человек открывает любую из них.
        </p>
        <ul className="mt-3 flex flex-col gap-3">
          {view.links.map((l) => (
            <li key={l.id} className="rounded-2xl border border-white/10 p-4 text-sm">
              <b>{l.label}</b>
              <div className="mt-1 text-zinc-400">
                переходы {l.clicks} · регистрации {l.signups} · пополнения {l.purchases} · оборот{" "}
                {rub(l.purchaseGrossPeaches)} · вам {rub(l.myCommission)}
              </div>
              <div className="mt-3 text-xs text-zinc-400">Переходник</div>
              <div className="break-all text-xs text-zinc-500">{l.bridgeUrl}</div>
              <button type="button" className="mt-1 rounded-full bg-white/10 px-3 py-1" onClick={() => void copy(l.bridgeUrl)}>
                Копировать переходник
              </button>
              <div className="mt-3 text-xs text-zinc-400">Напрямую в бота</div>
              <div className="break-all text-xs text-zinc-500">{l.telegramUrl}</div>
              <button type="button" className="mt-1 rounded-full bg-white/10 px-3 py-1" onClick={() => void copy(l.telegramUrl)}>
                Копировать ссылку на бота
              </button>
            </li>
          ))}
        </ul>
        {!investor ? (
          <form onSubmit={createLink} className="mt-3 flex gap-2">
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Название ссылки, например Посев"
              className="flex-1 rounded-xl border border-white/10 bg-[#121214] px-3 py-2 text-sm"
            />
            <button
              type="submit"
              disabled={busy}
              className="rounded-full btn-grad px-4 py-2 text-sm disabled:opacity-60"
            >
              Создать
            </button>
          </form>
        ) : null}
      </section>

      <section>
        <h2 className="text-lg">История начислений</h2>
        {view.accruals.length === 0 ? (
          <p className="mt-2 text-sm text-zinc-500">Пополнений по этому проекту ещё не было.</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-2 text-sm">
            {view.accruals.map((a) => (
              <li key={a.id} className="rounded-xl border border-white/10 px-3 py-2">
                {a.reversed ? "возврат · " : ""}
                {when(a.createdAt)} · {a.linkLabel}
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

function Stat(props: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 px-3 py-2">
      <div className="text-[11px] uppercase tracking-widest text-zinc-500">{props.label}</div>
      <div className="mt-1">{props.value}</div>
    </div>
  );
}

function ReportForm(props: {
  spend: { id: string; reportedAt: string | null };
  busy: boolean;
  onSubmit: (form: FormData) => void;
}) {
  return (
    <form
      className="mt-3 flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        props.onSubmit(new FormData(e.currentTarget));
      }}
    >
      <input
        name="title"
        required
        placeholder="Куда ушли деньги"
        className="rounded-xl border border-white/10 bg-[#121214] px-3 py-2"
      />
      <textarea
        name="body"
        required
        placeholder="Коротко: что купили и зачем"
        className="min-h-16 rounded-xl border border-white/10 bg-[#121214] px-3 py-2"
      />
      <label className="text-xs text-zinc-500">
        Скрин, если есть
        <input name="file" type="file" accept="image/jpeg,image/png,image/webp" className="mt-1 block text-sm" />
      </label>
      <button
        type="submit"
        disabled={props.busy}
        className="rounded-full bg-white/10 px-4 py-2 disabled:opacity-60"
      >
        {props.spend.reportedAt ? "Обновить отчёт" : "Прикрепить отчёт"}
      </button>
    </form>
  );
}
