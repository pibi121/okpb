"use client";

import { useRouter } from "next/navigation";
import { TgShell, useTgMiniApp } from "@/lib/tg/miniapp/client";
import {
  TgBannerCarousel,
  useHorizontalBanners,
} from "@/lib/tg/miniapp/banners-ui";

const UI = {
  ru: {
    title: "Профиль",
    cabinet: "Кабинет",
    topup: "Пополнить",
    partner: "Партнёрка",
    partnerDesc: "50% с платежей приведённых юзеров",
    promoDaily: "Бесплатный кадр студии: готов",
    promoDailyWait: "Зайди в ленту, чтобы активировать",
    loraLeft: "Бонусные фото своей модели:",
    videoDisc: "Скидка на 1-е видео:",
  },
  en: {
    title: "Profile",
    cabinet: "Account",
    topup: "Top up",
    partner: "Affiliate",
    partnerDesc: "50% from referred users' payments",
    promoDaily: "Studio free shot: ready",
    promoDailyWait: "Open feed to activate",
    loraLeft: "Bonus photos with your model:",
    videoDisc: "First video discount:",
  },
} as const;

export default function TgProfilePage() {
  const router = useRouter();
  const { status, error, profile, locale, setLocale, sendAction, refresh, apiFetch } =
    useTgMiniApp();
  const u = UI[locale];
  const banners = useHorizontalBanners(apiFetch);

  if (status === "loading") return <p className="tg-loading">…</p>;
  if (status === "error") return <p className="tg-error">{error}</p>;

  const promos = profile?.promos;

  return (
    <TgShell locale={locale}>
      <TgBannerCarousel banners={banners} />
      <div className="tg-section">
        <div className="tg-settings">
          <h2>{u.cabinet}</h2>
          <div className="tg-settings-row">
            <span>🍑 {profile?.balancePeaches ?? 0}</span>
            <button type="button" onClick={() => sendAction({ action: "topup" })}>
              {u.topup}
            </button>
          </div>
          {promos && (
            <>
              <div className="tg-settings-row">
                <span>
                  {promos.studioDailyFreeReady ? u.promoDaily : u.promoDailyWait}
                </span>
              </div>
              {promos.loraWelcomePhotosLeft > 0 && (
                <div className="tg-settings-row">
                  <span>
                    {u.loraLeft} {promos.loraWelcomePhotosLeft}
                  </span>
                </div>
              )}
              {promos.firstVideoDiscountAvailable && (
                <div className="tg-settings-row">
                  <span>
                    {u.videoDisc} −{promos.firstVideoDiscountPct}%
                  </span>
                </div>
              )}
            </>
          )}
          <div className="tg-settings-row">
            <button type="button" onClick={() => router.push("/tg/partner")}>
              {u.partner} →
            </button>
          </div>
          <div className="tg-settings-row">
            <small style={{ color: "var(--tg-muted)" }}>{u.partnerDesc}</small>
          </div>
          <div className="tg-settings-row">
            <span>{locale === "ru" ? "Язык" : "Language"}</span>
            <button
              type="button"
              className="tg-lang"
              onClick={() => {
                const next = locale === "ru" ? "en" : "ru";
                setLocale(next);
                void refresh(next);
              }}
            >
              {locale === "ru" ? "🇷🇺 RU" : "🇺🇸 EN"}
            </button>
          </div>
        </div>
      </div>
    </TgShell>
  );
}
