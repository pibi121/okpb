"use client";

import Link from "next/link";
import { TgShell, useTgMiniApp } from "@/lib/tg/miniapp/client";

const UI = {
  ru: {
    title: "Инструкция, как пользоваться",
    lead: "В PeachBitch ты можешь генерировать 👇",
    photoBadge: "📸 Фото",
    videoBadge: "🎬 Видео",
    photoIntro:
      "Фотографии самого высокого качества и реалистичности в Телеграм:",
    ownTitle: "С любой девушкой, подругой, знакомой, актрисой, блогершей…",
    ownBody:
      "Все боты-раздеваторы делают это на основе одной фотографии — и в результате ты получаешь глянцевое ИИ-фото, на которое даже смотреть страшно. У нас другой подход.",
    ownBody2:
      "Система обучается создавать фотографии на основе 5–20 фоток твоей модели: смотрит лицо и тело с разных ракурсов. Это занимает от 1 до 2 часов. Но в результате ты навсегда в своём кабинете получаешь модель, с которой можешь создавать сочные реалистичные фотки с максимальной схожестью во внешности.",
    createTitle: "Для создания образа",
    step1: "Перейди в «Студию», раздел «Персонажи» — или нажми кнопку ниже",
    step2: "Введи любое название своей модели",
    step3: "Добавь до 20 фотографий с разных ракурсов",
    step4: "Запусти создание образа и подожди 1–2 часа",
    onceNote:
      "Создание образа одного человека делается один раз, а создавать фото и видео с ним можно всегда.",
    ctaTrain: "Создать персонажа в студии",
    castTitle: "С нашим каталогом актрис",
    castBody:
      "Выбери в «Студии» в разделе «Персонажи» одну из наших моделей, далее выбери шаблон и сделай с ней фото/видео. Так ты поймёшь, насколько реалистичные и качественные материалы получаются.",
    ctaCast: "Выбрать готовую модель",
    videoLead: "А также самые сочные видео и сюжетные фильмы:",
    tmplTitle: "1. По готовым шаблонам",
    tmplBody:
      "Просто выбери шаблон, загрузи минимум 1 фотографию лица и внешности — получи готовое видео через несколько минут.",
    ctaVideo: "Выбрать шаблон видео",
    liveTitle: "2. Через оживление фотографии",
    liveBody:
      "Выбери любую фотографию из галереи, нажми «Оживить», впиши пожелание и получи готовое видео.",
    ctaLive: "Открыть галерею / фото",
    noTrainNote:
      "Для создания видео по обычным шаблонам (не макс. качества) и для оживления создание образа не требуется!",
  },
  en: {
    title: "How to use",
    lead: "In PeachBitch you can generate 👇",
    photoBadge: "📸 Photos",
    videoBadge: "🎬 Video",
    photoIntro: "Highest-quality realistic photos in Telegram:",
    ownTitle: "With any girl, friend, actress, blogger…",
    ownBody:
      "Most “undress” bots use a single photo and give you glossy AI junk. We do it differently.",
    ownBody2:
      "The system learns from 5–20 photos of your model — face and body from different angles. Training takes 1–2 hours. After that you permanently keep a model in your cabinet for juicy, realistic shots with strong likeness.",
    createTitle: "To create a look",
    step1: "Open Studio → Characters — or tap the button below",
    step2: "Enter any name for your model",
    step3: "Add up to 20 photos from different angles",
    step4: "Start training and wait 1–2 hours",
    onceNote:
      "You train a person once — then generate photos and videos with them anytime.",
    ctaTrain: "Create a character in Studio",
    castTitle: "With our actress catalog",
    castBody:
      "Pick one of our models in Studio → Characters, choose a template, and make a photo/video to see the quality.",
    ctaCast: "Pick a studio model",
    videoLead: "Plus juicy videos and story films:",
    tmplTitle: "1. Ready-made templates",
    tmplBody:
      "Pick a template, upload at least one face/body photo — get a video in a few minutes.",
    ctaVideo: "Open video templates",
    liveTitle: "2. Animate a photo",
    liveBody:
      "Pick any gallery photo, tap Animate, write a wish, and get a video.",
    ctaLive: "Open gallery / photo",
    noTrainNote:
      "For regular video templates (not max quality) and animation — no look training required!",
  },
} as const;

export default function TgGuidePage() {
  const { status, error, locale } = useTgMiniApp();
  const u = UI[locale];

  if (status === "loading") return <p className="tg-loading">…</p>;
  if (status === "error") return <p className="tg-error">{error}</p>;

  return (
    <TgShell locale={locale}>
      <main className="tg-guide">
        <div className="tg-guide-hero">
          <p className="tg-guide-kicker">PeachBitch</p>
          <h1>{u.title}</h1>
          <p className="tg-guide-lead">{u.lead}</p>
        </div>

        <section className="tg-guide-card">
          <div className="tg-guide-pill">{u.photoBadge}</div>
          <p className="tg-guide-intro">{u.photoIntro}</p>

          <div className="tg-guide-block">
            <h2>◕ {u.ownTitle}</h2>
            <p>{u.ownBody}</p>
            <p>{u.ownBody2}</p>
          </div>

          <div className="tg-guide-block tg-guide-block--accent">
            <h3>{u.createTitle}</h3>
            <ol className="tg-guide-steps">
              <li>{u.step1}</li>
              <li>{u.step2}</li>
              <li>{u.step3}</li>
              <li>{u.step4}</li>
            </ol>
            <p className="tg-guide-note">{u.onceNote}</p>
            <Link href="/tg/characters?section=train" className="tg-guide-cta">
              {u.ctaTrain}
            </Link>
          </div>

          <div className="tg-guide-block">
            <h2>◕ {u.castTitle}</h2>
            <p>{u.castBody}</p>
            <Link href="/tg/characters" className="tg-guide-cta tg-guide-cta--ghost">
              {u.ctaCast}
            </Link>
          </div>
        </section>

        <section className="tg-guide-card">
          <div className="tg-guide-pill tg-guide-pill--video">{u.videoBadge}</div>
          <p className="tg-guide-intro">{u.videoLead}</p>

          <div className="tg-guide-block tg-guide-block--accent">
            <h3>{u.tmplTitle}</h3>
            <p>{u.tmplBody}</p>
            <Link href="/tg/video" className="tg-guide-cta">
              {u.ctaVideo}
            </Link>
          </div>

          <div className="tg-guide-block">
            <h3>{u.liveTitle}</h3>
            <p>{u.liveBody}</p>
            <Link href="/tg/gallery" className="tg-guide-cta tg-guide-cta--ghost">
              {u.ctaLive}
            </Link>
          </div>

          <p className="tg-guide-banner">{u.noTrainNote}</p>
        </section>
      </main>
    </TgShell>
  );
}
