"use client";

import { Suspense, useEffect, useState } from "react";
import { QuickVideoLab } from "@/components/quick-video-lab";
import { QuickVideoTemplateUseFlow } from "@/components/quick-video-template-use-flow";
import { TodayGenerationsStrip } from "@/components/today-generations-strip";
import {
  BitchTemplatesMarketplace,
  PeachTemplatesMarketplace,
  QuickVideoTemplatesMarketplace,
  TemplateTicker,
  useVideoTab,
  VideoHubTabs,
  type PeachTemplateItem,
  type QuickVideoTemplateItem,
} from "@/components/peach-templates-marketplace";
import { SocialTemplateUsePanel } from "@/components/social-template-use-panel";

import type { VideoLegoFile } from "@/lib/prompt-lego-core";

type Char = {
  id: string;
  name: string;
  gender: string;
  triggerWord?: string | null;
  photoCount: number;
  refPhotoCount?: number;
  loraStatus: string;
};

export function VideoHubClient({
  characters,
  peachTemplates,
  quickVideoPeachTemplates,
  quickVideoBitchTemplates,
  videoLego,
}: {
  characters: Char[];
  peachTemplates: PeachTemplateItem[];
  quickVideoPeachTemplates: QuickVideoTemplateItem[];
  quickVideoBitchTemplates: QuickVideoTemplateItem[];
  videoLego: VideoLegoFile;
}) {
  return (
    <Suspense fallback={<div className="text-sm text-zinc-500">Загрузка…</div>}>
      <VideoHubInner
        characters={characters}
        peachTemplates={peachTemplates}
        quickVideoPeachTemplates={quickVideoPeachTemplates}
        quickVideoBitchTemplates={quickVideoBitchTemplates}
        videoLego={videoLego}
      />
    </Suspense>
  );
}

function VideoHubInner({
  characters,
  peachTemplates,
  quickVideoPeachTemplates,
  quickVideoBitchTemplates,
  videoLego,
}: {
  characters: Char[];
  peachTemplates: PeachTemplateItem[];
  quickVideoPeachTemplates: QuickVideoTemplateItem[];
  quickVideoBitchTemplates: QuickVideoTemplateItem[];
  videoLego: VideoLegoFile;
}) {
  const [stripRefresh, setStripRefresh] = useState(0);
  const { tab, setTab } = useVideoTab("create");

  useEffect(() => {
    const qv = new URL(window.location.href).searchParams.get("qvTemplate");
    if (qv && tab !== "create") setTab("create");
  }, [tab, setTab]);

  const qvTicker = [...quickVideoPeachTemplates, ...quickVideoBitchTemplates]
    .slice(0, 12)
    .map((t) => ({
      id: t.id,
      title: t.title,
      previewPhotoUrl: t.previewPhotoUrl || undefined,
      previewVideoUrl: t.previewVideoUrl || undefined,
      badge: (t.isJuice ? "juice" : t.category || "peach") as
        | "peach"
        | "bitch"
        | "juice",
      href: `/peach/video?tab=create&qvTemplate=${t.id}`,
    }));

  const tickerItems =
    qvTicker.length > 0
      ? qvTicker
      : peachTemplates.slice(0, 12).map((t) => ({
          id: t.id,
          title: t.title,
          previewPhotoUrl: t.previewPhotoUrl || undefined,
          previewVideoUrl: t.previewVideoUrl || undefined,
          badge: (t.isJuice ? "juice" : "peach") as "peach" | "bitch" | "juice",
          href: `/peach/video?tab=peach&template=${t.id}`,
        }));

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-medium">Видео</h2>
        <p className="text-sm text-zinc-500">
          Создай своё видео или выбери готовый шаблон Peach / Bitch.
        </p>
      </div>

      <TemplateTicker items={tickerItems} />

      <VideoHubTabs active={tab} onChange={setTab} />

      {tab === "create" ? (
        <>
          <QuickVideoTemplateUseFlow
            characters={characters.map((c) => ({ id: c.id, name: c.name }))}
          />
          <QuickVideoLab
            characters={characters}
            videoLego={videoLego}
            compact
            onRunStarted={() => setStripRefresh((k) => k + 1)}
          />
          <TodayGenerationsStrip
            kind="video"
            editor="video"
            refreshKey={stripRefresh}
          />
        </>
      ) : null}

      {tab === "peach" ? (
        <div className="flex flex-col gap-6">
          <div>
            <h3 className="mb-3 text-sm font-medium text-zinc-400">
              Быстрое видео · Peach
            </h3>
            <QuickVideoTemplatesMarketplace
              templates={quickVideoPeachTemplates}
              category="peach"
            />
          </div>
          <div>
            <h3 className="mb-3 text-sm font-medium text-zinc-400">
              Social Ref2V (legacy)
            </h3>
            <PeachTemplatesMarketplace templates={peachTemplates} />
            <SocialTemplateUsePanel
              characters={characters.map((c) => ({ id: c.id, name: c.name }))}
            />
          </div>
        </div>
      ) : null}

      {tab === "bitch" ? (
        <BitchTemplatesMarketplace templates={quickVideoBitchTemplates} />
      ) : null}
    </div>
  );
}
