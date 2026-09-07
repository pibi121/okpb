"use client";

import { Suspense, useState } from "react";
import { PhotoLabForm } from "@/components/photo-lab-form";
import { PhotoTemplateUseFlow } from "@/components/photo-template-use-flow";
import { TodayGenerationsStrip } from "@/components/today-generations-strip";
import {
  PeachPhotoTemplatesMarketplace,
  type PeachPhotoTemplateItem,
} from "@/components/peach-templates-marketplace";

type Char = {
  id: string;
  name: string;
  gender: string;
  loraStatus: string;
  triggerWord: string | null;
};

type PoseProp = {
  id: string;
  label: string;
  text: string;
  videoMotion?: string;
};

type LegoStatic = {
  lighting: Array<{ id: string; label: string; aliases?: string[] }>;
  events: Array<{ id: string; label: string; aliases?: string[] }>;
  stylization: Array<{ id: string; label: string; aliases?: string[] }>;
  body?: Array<{ id: string; label: string; aliases?: string[] }>;
};

export function PhotoHubClient({
  characters,
  poses,
  lego,
  peachPhotoTemplates,
  bitchPhotoTemplates,
}: {
  characters: Char[];
  poses: PoseProp[];
  lego: LegoStatic;
  peachPhotoTemplates: PeachPhotoTemplateItem[];
  bitchPhotoTemplates: PeachPhotoTemplateItem[];
}) {
  return (
    <Suspense fallback={<div className="text-sm text-zinc-500">Загрузка…</div>}>
      <PhotoHubInner
        characters={characters}
        poses={poses}
        lego={lego}
        peachPhotoTemplates={peachPhotoTemplates}
        bitchPhotoTemplates={bitchPhotoTemplates}
      />
    </Suspense>
  );
}

function PhotoHubInner({
  characters,
  poses,
  lego,
  peachPhotoTemplates,
  bitchPhotoTemplates,
}: {
  characters: Char[];
  poses: PoseProp[];
  lego: LegoStatic;
  peachPhotoTemplates: PeachPhotoTemplateItem[];
  bitchPhotoTemplates: PeachPhotoTemplateItem[];
}) {
  const [stripRefresh, setStripRefresh] = useState(0);

  return (
    <div className="flex flex-col gap-8">
      <Suspense>
        <PhotoTemplateUseFlow
          characters={characters.map((c) => ({ id: c.id, name: c.name }))}
        />
      </Suspense>

      <PhotoLabForm
        characters={characters}
        poses={poses}
        lego={lego}
        onRunStarted={() => setStripRefresh((k) => k + 1)}
      />

      <section className="flex flex-col gap-4">
        <div>
          <h3 className="text-base font-medium">Шаблоны Peach</h3>
          <p className="text-sm text-zinc-500">
            Сначала персонаж, затем шаблон. Лицо — из рефов, сцена — в промпте.
          </p>
        </div>
        <PeachPhotoTemplatesMarketplace
          templates={peachPhotoTemplates}
          category="peach"
        />
      </section>

      {bitchPhotoTemplates.length ? (
        <section className="flex flex-col gap-4">
          <h3 className="text-base font-medium">Шаблоны Bitch</h3>
          <PeachPhotoTemplatesMarketplace
            templates={bitchPhotoTemplates}
            category="bitch"
          />
        </section>
      ) : null}

      <TodayGenerationsStrip
        kind="photo"
        editor="photo"
        refreshKey={stripRefresh}
      />
    </div>
  );
}
