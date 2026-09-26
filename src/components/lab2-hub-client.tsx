"use client";

import Link from "next/link";

type Card = {
  href: string;
  title: string;
  blurb: string;
  status: "ready" | "extend" | "todo";
  external?: boolean;
};

const CARDS: Card[] = [
  {
    href: "/peach/photo-edit",
    title: "Позы (новый Photo Edit)",
    blurb:
      "Новый генератор воронки: Identity Edit → TG-шаблон (кнопка, описание, тизер, оживление 3/7/12). Без старой формы с LoRA.",
    status: "ready",
  },
  {
    href: "/peach/tg-photo",
    title: "TG фото-шаблоны",
    blurb: "Список поз / публикация (дубль каталога).",
    status: "ready",
  },
  {
    href: "/peach/tg-catalog",
    title: "TG каталог",
    blurb: "Публикация / порядок шаблонов для бота.",
    status: "ready",
  },
  {
    href: "/peach/tease-lab",
    title: "Tease (blur)",
    blurb: "Пресет blur для пробного фото без баланса.",
    status: "ready",
  },
  {
    href: "/peach/story-video",
    title: "Видео по 1 фото (из Lab 1.0)",
    blurb:
      "Единственный блок, перенесённый из старого: Story H3 + список шаблонов. Мета TG (кнопка, тизер, 🍓🍿💬) — для воронки.",
    status: "ready",
  },
  {
    href: "/peach/lora-i2v",
    title: "Сюжет / диалоги (новый I2V)",
    blurb:
      "Новый формат: только «по 1 фото» (Edit still → I2V шоты → шаблон). Legacy LoRA — только в Lab 1.0.",
    status: "ready",
  },
  {
    href: "/peach/gallery",
    title: "Галерея",
    blurb: "Проверка результатов генераций после тестов в лабе.",
    status: "ready",
  },
  {
    href: "/peach/characters",
    title: "Персонажи (PRO)",
    blurb: "Образы для PRO-режима воронки — не трогаем undress/позы 1.0.",
    status: "ready",
  },
  {
    href: "/ops/prices",
    title: "Цены 🍑 (ops)",
    blurb:
      "video_sec_animate и остальные тарифы. Оживление 3/7/12 сек = цена×секунды.",
    status: "ready",
    external: true,
  },
];

const ROADMAP = [
  "Наполнить контент: позы + тизеры + оживление 3/7/12",
  "Наполнить Story H3 и I2V one_photo с категориями",
  "Технарь: воронка читает PhotoTemplate.animateJson / previewVideoUrl / LoraI2v requiresLora=false",
];

function statusLabel(s: Card["status"]) {
  if (s === "ready") return { t: "готово", c: "text-emerald-400/90" };
  if (s === "extend") return { t: "допилить", c: "text-amber-400/90" };
  return { t: "todo", c: "text-zinc-500" };
}

export function Lab2HubClient() {
  return (
    <div className="flex flex-col gap-8">
      <div className="grid gap-3 sm:grid-cols-2">
        {CARDS.map((card) => {
          const st = statusLabel(card.status);
          const inner = (
            <>
              <div className="flex items-start justify-between gap-2">
                <h2 className="text-[15px] font-medium text-foreground">
                  {card.title}
                </h2>
                <span className={`shrink-0 text-[10px] uppercase ${st.c}`}>
                  {st.t}
                </span>
              </div>
              <p className="mt-1.5 text-[13px] leading-snug text-zinc-500">
                {card.blurb}
              </p>
            </>
          );
          const cls =
            "block rounded-2xl border border-white/10 bg-[#121214]/80 p-4 transition hover:border-peach/35";
          if (card.external) {
            return (
              <a key={card.href} href={card.href} className={cls}>
                {inner}
              </a>
            );
          }
          return (
            <Link key={card.href} href={card.href} className={cls}>
              {inner}
            </Link>
          );
        })}
      </div>

      <section className="rounded-2xl border border-dashed border-white/12 p-5">
        <h2 className="text-sm font-medium text-foreground">
          Дорожная карта Lab 2.0
        </h2>
        <p className="mt-1 text-[12px] text-zinc-500">
          То, чего ещё нет в данных/лабе — делаем здесь, воронку натягивает
          технарь.
        </p>
        <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-[13px] text-zinc-400">
          {ROADMAP.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ol>
      </section>
    </div>
  );
}
