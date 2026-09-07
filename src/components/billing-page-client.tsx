"use client";

import Link from "next/link";
import { DEFAULT_PLAN_ID, PEACH_PLANS, TOP_UP_PACKS, planById } from "@/lib/peach-plans";
import { SKU } from "@/lib/peach-economics";

export function BillingPageClient({ credits }: { credits: number }) {
  const current = planById(DEFAULT_PLAN_ID);

  return (
    <div className="flex flex-col gap-10">
      <div>
        <h2 className="text-lg font-medium">Тариф и баланс</h2>
        <p className="mt-1 text-sm text-zinc-500">
          Текущий план: <strong className="text-foreground">{current.name}</strong> ·{" "}
          {credits} кредитов
        </p>
      </div>

      <section>
        <h3 className="text-[11px] font-medium uppercase tracking-[0.28em] text-peach">
          Тарифы
        </h3>
        <div className="mt-4 grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
          {PEACH_PLANS.map((p) => (
            <div
              key={p.id}
              className={
                p.highlight
                  ? "rounded-2xl border border-peach/30 bg-gradient-to-br from-peach/10 to-[#121214] p-5"
                  : "rounded-2xl border border-white/10 bg-[#121214] p-5"
              }
            >
              <div className="flex items-baseline justify-between gap-2">
                <h4 className="font-display text-xl text-foreground">{p.name}</h4>
                {p.priceUsd === 0 ? (
                  <span className="text-sm text-zinc-500">Бесплатно</span>
                ) : (
                  <span className="text-sm text-foreground">${p.priceUsd}</span>
                )}
              </div>
              <p className="mt-2 text-2xl font-medium text-grad">
                {p.peaches.toLocaleString("ru-RU")}{" "}
                <span className="text-sm font-normal text-zinc-500">кр.</span>
              </p>
              <p className="mt-1 text-xs text-peach">{p.bonusLabel}</p>
              <ul className="mt-4 space-y-1 text-xs text-zinc-500">
                <li>{p.characters}</li>
                <li>{p.privacy}</li>
              </ul>
              <button
                type="button"
                disabled={p.id === DEFAULT_PLAN_ID}
                className="mt-4 w-full rounded-full border border-white/15 py-2 text-sm disabled:opacity-40"
                title="Оплата — скоро"
              >
                {p.id === DEFAULT_PLAN_ID ? "Текущий" : "Выбрать — скоро"}
              </button>
            </div>
          ))}
        </div>
      </section>

      <section id="topup">
        <h3 className="text-[11px] font-medium uppercase tracking-[0.28em] text-peach">
          Пополнение
        </h3>
        <p className="mt-2 text-sm text-zinc-500">
          Доступно на платных тарифах (Seed и выше). Оплата криптой — подключим позже.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {TOP_UP_PACKS.map((pack) => (
            <div
              key={pack.usd}
              className="rounded-2xl border border-white/10 bg-[#121214] p-4 text-center"
            >
              <div className="text-lg font-medium">${pack.usd}</div>
              <div className="mt-1 text-sm text-foreground">
                {pack.peaches.toLocaleString("ru-RU")} кр.
              </div>
              {pack.bonus ? (
                <div className="mt-1 text-xs text-peach">{pack.bonus}</div>
              ) : null}
              <button
                type="button"
                disabled
                className="mt-3 w-full rounded-full border border-white/10 py-1.5 text-xs opacity-50"
              >
                Скоро
              </button>
            </div>
          ))}
        </div>
      </section>

      <p className="text-xs text-zinc-600">
        Цены из{" "}
        <Link href="/peach/billing" className="text-peach">
          утверждённой экономики
        </Link>
        : 1 peach = $0.01 · фото {SKU.photo} кр. · клип 5с {SKU.clip5} кр.
      </p>
    </div>
  );
}
