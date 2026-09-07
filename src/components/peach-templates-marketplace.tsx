"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { MarketplaceCard } from "@/components/marketplace-card";
import { TgPublishControls } from "@/components/tg-publish-controls";
import { usePeachUiMode } from "@/components/peach-ui-mode-provider";

export type PeachTemplateItem = {
  id: string;
  title: string;
  notes: string;
  previewVideoUrl: string;
  previewPhotoUrl: string;
  durationSec: number;
  isJuice?: boolean;
};

export type PeachPhotoTemplateItem = {
  id: string;
  title: string;
  notes: string;
  previewImageUrl: string;
  orientation: string;
  isJuice?: boolean;
  priceCredits?: number;
  owned?: boolean;
  category?: "peach" | "bitch";
};

export function PeachPhotoTemplatesMarketplace({
  templates,
  category,
}: {
  templates: PeachPhotoTemplateItem[];
  category: "peach" | "bitch";
}) {
  if (!templates.length) {
    return (
      <div className="rounded-2xl border border-dashed border-white/12 p-10 text-center text-sm text-zinc-500">
        {category === "bitch"
          ? "Пока нет Bitch-шаблонов фото."
          : "Пока нет Peach-шаблонов фото. Сохрани готовое фото как шаблон."}
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {templates.map((t) => {
        const priceLabel =
          t.isJuice && t.priceCredits
            ? t.owned
              ? "Куплено"
              : `${t.priceCredits} кр.`
            : "Бесплатно";
        return (
          <MarketplaceCard
            key={t.id}
            title={t.title}
            description={
              t.notes
                ? `${t.notes} · ${priceLabel}`
                : priceLabel
            }
            previewImage={t.previewImageUrl || undefined}
            badge={t.isJuice ? "juice" : category}
            href={`/peach/photo?photoTemplate=${t.id}`}
          />
        );
      })}
    </div>
  );
}

export type QuickVideoTemplateItem = PeachTemplateItem & {
  priceCredits?: number;
  owned?: boolean;
  category?: "peach" | "bitch";
  isAuthor?: boolean;
  tgPublished?: boolean;
  tgDisplayTitle?: string;
};

export function QuickVideoTemplatesMarketplace({
  templates,
  category,
}: {
  templates: QuickVideoTemplateItem[];
  category: "peach" | "bitch";
}) {
  const { isAdmin } = usePeachUiMode();

  if (!templates.length) {
    return (
      <div className="rounded-2xl border border-dashed border-white/12 p-10 text-center text-sm text-zinc-500">
        {category === "bitch"
          ? "Пока нет Bitch-шаблонов быстрого видео."
          : "Пока нет Peach-шаблонов быстрого видео."}
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {templates.map((t) => {
        const priceLabel =
          t.isJuice && t.priceCredits
            ? t.owned
              ? "Куплено"
              : `${t.priceCredits} кр.`
            : "Бесплатно";
        return (
          <div key={t.id} className="flex flex-col">
            <MarketplaceCard
              title={t.title}
              description={
                t.notes
                  ? `${t.notes} · ~${t.durationSec}с · ${priceLabel}`
                  : `~${t.durationSec} сек · ${priceLabel}`
              }
              previewImage={t.previewPhotoUrl || undefined}
              previewVideo={t.previewVideoUrl || undefined}
              badge={t.isJuice ? "juice" : category}
              href={`/peach/video?tab=create&qvTemplate=${t.id}`}
            />
            {isAdmin && t.isAuthor ? (
              <TgPublishControls
                templateId={t.id}
                kind="video"
                initialPublished={t.tgPublished}
                initialDisplayTitle={t.tgDisplayTitle || t.title}
                defaultTitle={t.title}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export function PeachTemplatesMarketplace({
  templates,
  useHref,
}: {
  templates: PeachTemplateItem[];
  /** Куда ведёт «использовать» — например /peach/video?tab=peach&template=ID */
  useHref?: (id: string) => string;
}) {
  if (!templates.length) {
    return (
      <div className="rounded-2xl border border-dashed border-white/12 p-10 text-center text-sm text-zinc-500">
        Пока нет опубликованных шаблонов Peach. Скоро добавим новые.
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {templates.map((t) => (
        <MarketplaceCard
          key={t.id}
          title={t.title}
          description={t.notes || `~${t.durationSec} сек`}
          previewImage={t.previewPhotoUrl || undefined}
          previewVideo={t.previewVideoUrl || undefined}
          badge={t.isJuice ? "juice" : "peach"}
          href={useHref ? useHref(t.id) : `/peach/video?tab=peach&template=${t.id}`}
        />
      ))}
    </div>
  );
}

export function BitchTemplatesMarketplace({
  templates,
}: {
  templates: QuickVideoTemplateItem[];
}) {
  return (
    <QuickVideoTemplatesMarketplace templates={templates} category="bitch" />
  );
}

/** @deprecated use BitchTemplatesMarketplace */
export function BitchTemplatesEmpty() {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/12 py-16 text-center">
      <div className="mb-3 text-3xl opacity-60">✦</div>
      <h3 className="font-medium text-foreground">Bitch Templates</h3>
      <p className="mt-2 max-w-sm text-sm text-zinc-500">
        Здесь появятся готовые шаблоны промптов и настроек быстрого видео. Раздел
        готов — наполним позже.
      </p>
    </div>
  );
}

/** Бегущая лента шаблонов над видео-хабом */
export function TemplateTicker({
  items,
}: {
  items: Array<{
    id: string;
    title: string;
    previewPhotoUrl?: string;
    previewVideoUrl?: string;
    badge: "peach" | "bitch" | "juice";
    href: string;
  }>;
}) {
  const [open, setOpen] = useState(true);

  useEffect(() => {
    try {
      const v = sessionStorage.getItem("peach-template-ticker-open");
      if (v === "0") setOpen(false);
    } catch {
      /* ignore */
    }
  }, []);

  const toggle = useCallback(() => {
    setOpen((o) => {
      const next = !o;
      try {
        sessionStorage.setItem("peach-template-ticker-open", next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  if (!items.length) return null;

  const doubled = [...items, ...items];

  return (
    <div className="mb-6 overflow-hidden rounded-2xl border border-white/10 bg-[#101012]">
      <div className="flex items-center justify-between border-b border-white/8 px-4 py-2">
        <span className="text-[11px] uppercase tracking-widest text-zinc-500">
          Популярные шаблоны
        </span>
        <button
          type="button"
          onClick={toggle}
          className="text-[11px] text-zinc-500 hover:text-foreground"
        >
          {open ? "Скрыть" : "Показать"}
        </button>
      </div>
      {open ? (
        <div className="relative overflow-hidden py-3">
          <div className="flex animate-[ticker_40s_linear_infinite] gap-3 px-3">
            {doubled.map((item, i) => (
              <TickerCard key={`${item.id}-${i}`} item={item} />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function TickerCard({
  item,
}: {
  item: {
    id: string;
    title: string;
    previewPhotoUrl?: string;
    previewVideoUrl?: string;
    badge: "peach" | "bitch" | "juice";
    href: string;
  };
}) {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => router.push(item.href)}
      className="group relative w-[140px] shrink-0 overflow-hidden rounded-xl border border-white/10 text-left"
    >
      <div className="aspect-[9/14] bg-gradient-to-br from-[#1a1218] to-[#101820]">
        {item.previewVideoUrl ? (
          <video
            src={item.previewVideoUrl}
            poster={item.previewPhotoUrl || undefined}
            muted
            loop
            playsInline
            preload="metadata"
            className="h-full w-full object-cover"
          />
        ) : item.previewPhotoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.previewPhotoUrl} alt="" className="h-full w-full object-cover" />
        ) : null}
      </div>
      <span className="absolute left-1.5 top-1.5 rounded px-1.5 py-0.5 text-[9px] uppercase text-white/90 bg-black/50">
        {item.badge}
      </span>
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 p-2">
        <p className="truncate text-[10px] text-white">{item.title}</p>
      </div>
    </button>
  );
}

export function VideoHubTabs({
  active,
  onChange,
}: {
  active: string;
  onChange: (tab: string) => void;
}) {
  const tabs = [
    { id: "create", label: "Создание видео" },
    { id: "peach", label: "Peach Templates" },
    { id: "bitch", label: "Bitch Templates" },
  ];
  return (
    <div className="flex flex-wrap gap-2 border-b border-white/8 pb-3">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => onChange(t.id)}
          className={
            active === t.id
              ? "rounded-full bg-peach/15 px-4 py-2 text-sm text-peach"
              : "rounded-full px-4 py-2 text-sm text-zinc-500 hover:bg-white/5 hover:text-foreground"
          }
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function useVideoTab(defaultTab = "create") {
  const sp = useSearchParams();
  const router = useRouter();
  const tab = sp.get("tab") || defaultTab;

  const setTab = useCallback(
    (next: string) => {
      const u = new URL(window.location.href);
      u.searchParams.set("tab", next);
      router.replace(u.pathname + u.search);
    },
    [router],
  );

  return { tab, setTab };
}
