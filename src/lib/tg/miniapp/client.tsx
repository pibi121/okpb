"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { TgTabIcon } from "@/lib/tg/miniapp/tab-icons";

export type TgMiniAppProfile = {
  balancePeaches: number;
  locale: "ru" | "en";
  promos: {
    studioDailyFreeReady: boolean;
    loraWelcomePhotosLeft: number;
    firstVideoDiscountAvailable: boolean;
    firstVideoDiscountPct: number;
  };
  characters: Array<{
    id: string;
    name: string;
    loraStatus: string;
    photoCount: number;
    isStudioCast: boolean;
    videoRefOnly?: boolean;
    coverUrl?: string | null;
    loraUsable?: boolean;
    needsGpuTrain?: boolean;
    train?: {
      percent: number;
      etaMinutes: number;
      estimateTotalMinutes: number;
      etaLabel: string;
      phase: string;
      epoch?: number;
      epochs?: number;
    };
  }>;
  videoRefs?: Array<{ id: string; name: string; photoCount: number; videoRefOnly: boolean }>;
  casts: Array<{ id: string; name: string; coverUrl: string | null }>;
  favoriteCastIds?: string[];
  train?: {
    pricePeaches: number;
    minPhotos: number;
    maxPhotos: number;
  };
  botUsername?: string;
  supportUrl?: string;
};

/** Filled from /api/tg/me so TgShell footer picks up Railway TG_SUPPORT_CONTACT. */
let cachedSupportUrl = "https://t.me/peachbitch_support";

function rememberSupportUrl(url?: string) {
  const next = url?.trim();
  if (next) cachedSupportUrl = next;
}

const UI = {
  ru: {
    openInTg: "Открой из Telegram Mini App",
    authErr: "Ошибка авторизации",
    profileErr: "Не удалось загрузить профиль — открой мини-апп ещё раз",
    busyErr: "Сервер перезапускается — подожди 5 сек и открой снова",
    loading: "Загрузка…",
    feed: "Лента",
    gallery: "Галерея",
    chars: "Персонажи",
    photo: "Фото",
    video: "Видео",
    profile: "Профиль",
    balance: "Баланс",
    legalRules: "Политика, правила, оферта",
    legalSupport: "Поддержка",
    guide: "Инструкция, как пользоваться",
  },
  en: {
    openInTg: "Open from Telegram Mini App",
    authErr: "Auth failed",
    profileErr: "Could not load profile — reopen the mini app",
    busyErr: "Server is restarting — wait 5s and open again",
    loading: "Loading…",
    feed: "Feed",
    gallery: "Gallery",
    chars: "Cast",
    photo: "Photo",
    video: "Video",
    profile: "Profile",
    balance: "Balance",
    legalRules: "Policy, rules & offer",
    legalSupport: "Support",
    guide: "How to use",
  },
} as const;

declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        initData: string;
        platform?: string;
        ready: () => void;
        expand: () => void;
        close: () => void;
        sendData: (data: string) => void;
        setHeaderColor: (color: string) => void;
        setBackgroundColor: (color: string) => void;
        showAlert?: (message: string, callback?: () => void) => void;
        openTelegramLink?: (url: string) => void;
        HapticFeedback?: {
          notificationOccurred?: (type: "error" | "success" | "warning") => void;
        };
      };
    };
  }
}

async function waitInitData(maxMs = 6000): Promise<string> {
  const started = Date.now();
  while (Date.now() - started < maxMs) {
    const d = window.Telegram?.WebApp?.initData;
    if (d) return d;
    await new Promise((r) => setTimeout(r, 80));
  }
  return window.Telegram?.WebApp?.initData || "";
}

function tgFetch(
  initData: string,
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const headers = new Headers(init?.headers);
  if (initData) headers.set("X-Tg-Init-Data", initData);
  return fetch(input, {
    ...init,
    credentials: "include",
    headers,
  });
}

async function fetchWithRetry(
  initData: string,
  input: RequestInfo | URL,
  init?: RequestInit,
  tries = 3,
): Promise<Response> {
  let last: Response | null = null;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await tgFetch(initData, input, init);
      last = res;
      if (res.status < 500) return res;
    } catch {
      /* network blip while Next restarts after OOM */
    }
    await new Promise((r) => setTimeout(r, 800 * (i + 1)));
  }
  if (last) return last;
  throw new Error("network");
}

export function useTgMiniApp() {
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [profile, setProfile] = useState<TgMiniAppProfile | null>(null);
  const [locale, setLocale] = useState<"ru" | "en">("ru");
  const initDataRef = useRef("");

  const refresh = useCallback(async (loc?: "ru" | "en") => {
    const initData = initDataRef.current;
    if (!initData) throw new Error("no initData");
    const q = loc ? `?locale=${loc}` : "";
    const res = await fetchWithRetry(initData, `/api/tg/me${q}`);
    if (!res.ok) {
      const err = new Error(res.status >= 500 ? "busy" : "profile");
      throw err;
    }
    const data = (await res.json()) as TgMiniAppProfile;
    rememberSupportUrl(data.supportUrl);
    setProfile(data);
    if (data.locale === "en" || data.locale === "ru") setLocale(data.locale);
    return data;
  }, []);

  useEffect(() => {
    void (async () => {
      window.Telegram?.WebApp?.ready();
      window.Telegram?.WebApp?.expand();
      window.Telegram?.WebApp?.setHeaderColor?.("#070708");
      window.Telegram?.WebApp?.setBackgroundColor?.("#070708");

      const initData = await waitInitData();
      initDataRef.current = initData;
      if (!initData) {
        setError(UI.ru.openInTg);
        setStatus("error");
        return;
      }

      let authRes: Response;
      try {
        authRes = await fetchWithRetry(initData, "/api/tg/auth", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ initData }),
        });
      } catch {
        setError(UI.ru.busyErr);
        setStatus("error");
        return;
      }

      if (!authRes.ok) {
        const detail = await authRes.text().catch(() => "");
        console.error("[tg-auth]", authRes.status, detail.slice(0, 200));
        setError(authRes.status >= 500 ? UI.ru.busyErr : UI.ru.authErr);
        setStatus("error");
        return;
      }

      void fetchWithRetry(initData, "/api/tg/miniapp-heartbeat", {
        method: "POST",
      }).catch(() => undefined);

      void fetchWithRetry(initData, "/api/tg/funnel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventKey: "miniapp.open" }),
      }).catch(() => undefined);

      try {
        await refresh();
        setStatus("ready");
      } catch (e) {
        console.error("[tg-me]", e);
        const msg = e instanceof Error ? e.message : "";
        setError(msg === "busy" ? UI.ru.busyErr : UI.ru.profileErr);
        setStatus("error");
      }
    })();
  }, [refresh]);

  const apiFetch = useCallback(
    (input: RequestInfo | URL, init?: RequestInit) =>
      tgFetch(initDataRef.current, input, init),
    [],
  );

  const sendAction = useCallback((payload: Record<string, unknown>) => {
    void tgFetch(initDataRef.current, "/api/tg/funnel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        eventKey: "miniapp.send_to_bot",
        meta: { action: payload?.action || payload?.type || "sendData" },
      }),
    }).catch(() => undefined);
    window.Telegram?.WebApp?.sendData(JSON.stringify(payload));
    window.Telegram?.WebApp?.close();
  }, []);

  const trackEvent = useCallback(
    (eventKey: string, meta?: Record<string, unknown>) => {
      void tgFetch(initDataRef.current, "/api/tg/funnel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventKey, meta }),
      }).catch(() => undefined);
    },
    [],
  );

  return {
    status,
    error,
    profile,
    locale,
    setLocale,
    refresh,
    sendAction,
    apiFetch,
    trackEvent,
  };
}

function trackMiniAppClient(eventKey: string, meta?: Record<string, unknown>) {
  try {
    const initData = window.Telegram?.WebApp?.initData || "";
    if (!initData) return;
    void fetch("/api/tg/funnel", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Tg-Init-Data": initData,
      },
      body: JSON.stringify({ eventKey, meta }),
    }).catch(() => undefined);
  } catch {
    /* ignore */
  }
}

export function TgTabBar({ locale }: { locale: "ru" | "en" }) {
  const path = usePathname();
  const u = UI[locale];
  const feedActive = path === "/tg" || path === "/tg/templates";
  const charsActive =
    path.startsWith("/tg/characters") || path === "/tg/casts";
  const photoActive =
    path.startsWith("/tg/photo") || path === "/tg/studio-photo";
  const videoActive = path.startsWith("/tg/video");
  const galleryActive = path === "/tg/gallery";
  const profileActive = path.startsWith("/tg/profile") || path.startsWith("/tg/partner");

  return (
    <nav className="tg-tabbar">
      <Link
        href="/tg"
        className={feedActive ? "active" : ""}
        onClick={() => trackMiniAppClient("miniapp.tab.feed")}
      >
        <span className="tg-tab-ico">
          <TgTabIcon id="feed" active={feedActive} />
        </span>
        {u.feed}
      </Link>
      <Link
        href="/tg/gallery"
        className={galleryActive ? "active" : ""}
        onClick={() => trackMiniAppClient("miniapp.tab.gallery")}
      >
        <span className="tg-tab-ico">
          <TgTabIcon id="gallery" active={galleryActive} />
        </span>
        {u.gallery}
      </Link>
      <Link
        href="/tg/characters"
        className={charsActive ? "active" : ""}
        onClick={() => trackMiniAppClient("miniapp.tab.characters")}
      >
        <span className="tg-tab-ico">
          <TgTabIcon id="chars" active={charsActive} />
        </span>
        {u.chars}
      </Link>
      <Link
        href="/tg/photo"
        className={photoActive ? "active" : ""}
        onClick={() => trackMiniAppClient("miniapp.tab.photo")}
      >
        <span className="tg-tab-ico">
          <TgTabIcon id="photo" active={photoActive} />
        </span>
        {u.photo}
      </Link>
      <Link
        href="/tg/video"
        className={videoActive ? "active" : ""}
        onClick={() => trackMiniAppClient("miniapp.tab.video")}
      >
        <span className="tg-tab-ico">
          <TgTabIcon id="video" active={videoActive} />
        </span>
        {u.video}
      </Link>
      <Link
        href="/tg/profile"
        className={profileActive ? "active" : ""}
        onClick={() => trackMiniAppClient("miniapp.tab.profile")}
      >
        <span className="tg-tab-ico">
          <TgTabIcon id="profile" active={profileActive} />
        </span>
        {u.profile}
      </Link>
    </nav>
  );
}

export function TgLegalFooter({ locale }: { locale: "ru" | "en" }) {
  const u = UI[locale];
  const rulesHref = `/tg/rules?lang=${locale === "en" ? "en" : "ru"}`;
  const support = cachedSupportUrl;

  const openSupport = (e: React.MouseEvent) => {
    e.preventDefault();
    trackMiniAppClient("miniapp.footer.support");
    const tg = window.Telegram?.WebApp;
    if (tg?.openTelegramLink) {
      tg.openTelegramLink(support);
      return;
    }
    window.open(support, "_blank", "noopener,noreferrer");
  };

  return (
    <footer className="tg-legal-footer">
      <Link
        href={rulesHref}
        className="tg-legal-link"
        onClick={() => trackMiniAppClient("miniapp.footer.rules")}
      >
        {u.legalRules}
      </Link>
      <span className="tg-legal-dot" aria-hidden>
        ·
      </span>
      <a href={support} className="tg-legal-link" onClick={openSupport}>
        {u.legalSupport}
      </a>
    </footer>
  );
}

function TgScreenTracker() {
  const path = usePathname();
  useEffect(() => {
    const key = (() => {
      const p = path.replace(/\/+$/, "") || "/tg";
      if (p === "/tg" || p === "/tg/templates") return "miniapp.screen.feed";
      if (p.startsWith("/tg/gallery")) return "miniapp.screen.gallery";
      if (p.startsWith("/tg/characters") || p === "/tg/casts") {
        return "miniapp.screen.characters";
      }
      if (p.startsWith("/tg/photo") || p === "/tg/studio-photo") {
        return "miniapp.screen.photo";
      }
      if (p.startsWith("/tg/video")) return "miniapp.screen.video";
      if (p.startsWith("/tg/partner")) return "miniapp.screen.partner";
      if (p.startsWith("/tg/profile")) return "miniapp.screen.profile";
      if (p.startsWith("/tg/rules")) return "miniapp.screen.rules";
      if (p.startsWith("/tg/guide")) return "miniapp.screen.guide";
      return "miniapp.screen.other";
    })();
    trackMiniAppClient(key, { path });
  }, [path]);
  return null;
}

export function TgShell({
  children,
  locale,
}: {
  children: React.ReactNode;
  locale: "ru" | "en";
  /** @deprecated unused — logo-only header */
  balance?: number;
  /** @deprecated unused — logo-only header */
  title?: string;
  /** @deprecated language lives in Profile */
  onLangToggle?: () => void;
  /** @deprecated unused — logo-only header */
  hideTitle?: boolean;
  /** @deprecated ignored extras from older callers */
  status?: unknown;
  error?: unknown;
}) {
  const u = UI[locale];
  return (
    <div className="tg-shell">
      <TgScreenTracker />
      <header className="tg-header tg-header--bar">
        <Link href="/tg" className="tg-header-logo" aria-label="Peach Bitch">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/tg/peach-logo.png" alt="Peach Bitch" className="tg-logo" />
        </Link>
        <Link
          href="/tg/guide"
          className="tg-header-guide"
          onClick={() => trackMiniAppClient("miniapp.action", { action: "open_guide" })}
        >
          {u.guide}
        </Link>
      </header>
      {children}
      <TgLegalFooter locale={locale} />
      <TgTabBar locale={locale} />
    </div>
  );
}
