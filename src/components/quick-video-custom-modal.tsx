"use client";

import { useEffect, useState } from "react";
import {
  MAX_CUSTOM_CHARACTER_REFS,
  normalizeCustomCharacterName,
  type QuickVideoCustomCharacter,
} from "@/lib/quick-video-custom-character";

type RefDraft = {
  file: File;
  previewUrl: string;
};

export function QuickVideoCustomModal({
  open,
  initialName = "",
  initialFiles = [],
  onClose,
  onSave,
}: {
  open: boolean;
  initialName?: string;
  initialFiles?: File[];
  onClose: () => void;
  onSave: (payload: { character: QuickVideoCustomCharacter; files: File[] }) => void;
}) {
  const [name, setName] = useState(initialName);
  const [refs, setRefs] = useState<RefDraft[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setName(initialName);
    setError("");
    setRefs((prev) => {
      for (const r of prev) URL.revokeObjectURL(r.previewUrl);
      return initialFiles.map((file) => ({
        file,
        previewUrl: URL.createObjectURL(file),
      }));
    });
    return () => {
      setRefs((prev) => {
        for (const r of prev) URL.revokeObjectURL(r.previewUrl);
        return [];
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  function addFiles(list: FileList | File[]) {
    const incoming = [...list].filter((f) => f.type.startsWith("image/"));
    if (!incoming.length) return;
    setRefs((prev) => {
      const room = MAX_CUSTOM_CHARACTER_REFS - prev.length;
      if (room <= 0) return prev;
      return [
        ...prev,
        ...incoming.slice(0, room).map((file) => ({
          file,
          previewUrl: URL.createObjectURL(file),
        })),
      ];
    });
  }

  function removeRef(index: number) {
    setRefs((prev) => {
      const next = [...prev];
      const cur = next[index];
      if (cur?.previewUrl) URL.revokeObjectURL(cur.previewUrl);
      next.splice(index, 1);
      return next;
    });
  }

  function handleSave() {
    const trimmed = normalizeCustomCharacterName(name);
    if (trimmed.length < 2) {
      setError("Имя — минимум 2 символа");
      return;
    }
    if (!refs.length) {
      setError("Добавь хотя бы один референс");
      return;
    }
    onSave({
      character: { id: "", name: trimmed },
      files: refs.map((r) => r.file),
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4">
      <div className="w-full max-w-lg rounded-2xl border border-peach/25 bg-[#141416] p-5 shadow-xl">
        <h3 className="text-base font-medium text-foreground">Custom · только рефы</h3>
        <p className="mt-1 text-xs text-zinc-500">
          До {MAX_CUSTOM_CHARACTER_REFS} фото. Без LoRA — лицо держится по картинкам. Пропадёт после
          обновления страницы; «Изменить» после генерации вернёт настройки.
        </p>

        <label className="mt-4 block text-sm">
          <span className="text-zinc-400">Имя в табах и промпте</span>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Anna / Redhead / Model A"
            className="mt-1 w-full rounded-lg border border-white/10 bg-[#0c0c0e] px-3 py-2 text-sm outline-none focus:border-peach/40"
          />
        </label>

        <div className="mt-4">
          <div className="mb-2 flex items-center justify-between text-xs text-zinc-500">
            <span>Референсы ({refs.length}/{MAX_CUSTOM_CHARACTER_REFS})</span>
            <label className="cursor-pointer text-peach hover:underline">
              + Добавить
              <input
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => {
                  if (e.target.files?.length) addFiles(e.target.files);
                  e.target.value = "";
                }}
              />
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            {refs.map((ref, i) => (
              <div key={ref.previewUrl} className="relative h-20 w-20 overflow-hidden rounded-lg border border-white/10">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={ref.previewUrl} alt="" className="h-full w-full object-cover" />
                <button
                  type="button"
                  onClick={() => removeRef(i)}
                  className="absolute right-0.5 top-0.5 rounded bg-black/70 px-1 text-[10px] text-white"
                >
                  ×
                </button>
              </div>
            ))}
            {refs.length < MAX_CUSTOM_CHARACTER_REFS ? (
              <label className="flex h-20 w-20 cursor-pointer items-center justify-center rounded-lg border border-dashed border-white/20 text-2xl text-zinc-600 hover:border-peach/40 hover:text-peach">
                +
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files?.length) addFiles(e.target.files);
                    e.target.value = "";
                  }}
                />
              </label>
            ) : null}
          </div>
        </div>

        {error ? (
          <p className="mt-3 text-sm text-red-400">{error}</p>
        ) : null}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-white/15 px-4 py-1.5 text-sm"
          >
            Отмена
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="rounded-full bg-peach px-4 py-1.5 text-sm font-medium text-black"
          >
            Сохранить
          </button>
        </div>
      </div>
    </div>
  );
}
