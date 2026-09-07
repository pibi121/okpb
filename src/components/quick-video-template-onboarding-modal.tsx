"use client";

import { useMemo, useState } from "react";
import type { PublicQuickVideoTemplate } from "@/lib/quick-video-template";
import { MAX_CUSTOM_CHARACTER_REFS } from "@/lib/quick-video-custom-character";

type Char = { id: string; name: string };

export type TemplateOnboardingResult = {
  identityMode: "character" | "custom";
  characterIds: string[];
  customName?: string;
  identityFiles: File[];
  locationFile: File | null;
};

export function QuickVideoTemplateOnboardingModal({
  template,
  characters,
  onCancel,
  onContinue,
}: {
  template: PublicQuickVideoTemplate & {
    defaultLocationUrl?: string;
  };
  characters: Char[];
  onCancel: () => void;
  onContinue: (result: TemplateOnboardingResult) => void;
}) {
  const [identityMode, setIdentityMode] = useState<"character" | "custom">(
    characters.length ? "character" : "custom",
  );
  const [characterId, setCharacterId] = useState(characters[0]?.id || "");
  const [customName, setCustomName] = useState("Model");
  const [identityFiles, setIdentityFiles] = useState<File[]>([]);
  const [locationFile, setLocationFile] = useState<File | null>(null);
  const [error, setError] = useState("");

  const identityPreviews = useMemo(
    () => identityFiles.map((f) => URL.createObjectURL(f)),
    [identityFiles],
  );

  function onIdentityPick(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []).slice(
      0,
      MAX_CUSTOM_CHARACTER_REFS,
    );
    setIdentityFiles(files);
    e.target.value = "";
  }

  function submit() {
    setError("");
    if (identityMode === "character") {
      if (!characterId) {
        setError("Выбери персонажа");
        return;
      }
      onContinue({
        identityMode: "character",
        characterIds: [characterId],
        identityFiles: [],
        locationFile,
      });
      return;
    }
    if (identityFiles.length < 1) {
      setError("Загрузи хотя бы 1 фото модели (до 5)");
      return;
    }
    if (customName.trim().length < 2) {
      setError("Имя custom-модели — минимум 2 символа");
      return;
    }
    onContinue({
      identityMode: "custom",
      characterIds: [],
      customName: customName.trim(),
      identityFiles,
      locationFile,
    });
  }

  const n = template.identityPersonCount;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-white/10 bg-[#161618] p-5 shadow-xl">
        <h3 className="text-lg font-medium">{template.title}</h3>
        <p className="mt-2 text-sm text-zinc-400">
          В этой сцене{" "}
          <strong className="text-foreground">
            {n} {n === 1 ? "человек" : n < 5 ? "человека" : "человек"}
          </strong>
          . Загрузи до {MAX_CUSTOM_CHARACTER_REFS} фото на каждого — или выбери
          персонажа из библиотеки.
        </p>
        {template.hasLocationSlot ? (
          <p className="mt-2 text-sm text-zinc-500">
            Локация: можно загрузить свой референс (необязательно). Если пропустишь —
            будет фон из шаблона.
          </p>
        ) : null}

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            disabled={!characters.length}
            onClick={() => setIdentityMode("character")}
            className={`rounded-full border px-3 py-1 text-xs ${
              identityMode === "character"
                ? "border-peach bg-peach/15 text-peach"
                : "border-white/15"
            }`}
          >
            Персонаж
          </button>
          <button
            type="button"
            onClick={() => setIdentityMode("custom")}
            className={`rounded-full border px-3 py-1 text-xs ${
              identityMode === "custom"
                ? "border-peach bg-peach/15 text-peach"
                : "border-white/15"
            }`}
          >
            Custom (фото)
          </button>
        </div>

        {identityMode === "character" ? (
          <label className="mt-3 block text-sm">
            <span className="text-zinc-500">Персонаж</span>
            <select
              className="mt-1 w-full rounded-lg border border-white/10 bg-[#0c0c0e] px-3 py-2 text-sm"
              value={characterId}
              onChange={(e) => setCharacterId(e.target.value)}
            >
              {characters.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <div className="mt-3 space-y-2">
            <label className="block text-sm">
              <span className="text-zinc-500">Имя модели</span>
              <input
                className="mt-1 w-full rounded-lg border border-white/10 bg-[#0c0c0e] px-3 py-2 text-sm"
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
              />
            </label>
            <label className="block text-sm">
              <span className="text-zinc-500">
                Фото ({identityFiles.length}/{MAX_CUSTOM_CHARACTER_REFS})
              </span>
              <input
                type="file"
                accept="image/*"
                multiple
                className="mt-1 block w-full text-xs"
                onChange={onIdentityPick}
              />
            </label>
            {identityPreviews.length ? (
              <div className="flex flex-wrap gap-2">
                {identityPreviews.map((url, i) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={url}
                    src={url}
                    alt=""
                    className="h-14 w-14 rounded object-cover"
                  />
                ))}
              </div>
            ) : null}
          </div>
        )}

        {template.hasLocationSlot ? (
          <label className="mt-4 block text-sm">
            <span className="text-zinc-500">Референс локации (опционально)</span>
            <input
              type="file"
              accept="image/*"
              className="mt-1 block w-full text-xs"
              onChange={(e) => setLocationFile(e.target.files?.[0] || null)}
            />
          </label>
        ) : null}

        {error ? (
          <p className="mt-3 text-xs text-red-400">{error}</p>
        ) : null}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            className="rounded-full border border-white/15 px-4 py-2 text-sm"
            onClick={onCancel}
          >
            Отмена
          </button>
          <button
            type="button"
            className="rounded-full bg-peach px-4 py-2 text-sm font-medium text-black"
            onClick={submit}
          >
            Продолжить в редактор
          </button>
        </div>
      </div>
    </div>
  );
}
