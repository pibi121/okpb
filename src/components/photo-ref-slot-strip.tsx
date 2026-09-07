"use client";

import { useEffect, useMemo, useState } from "react";
import type { TemplateSlotBlueprint } from "@/lib/quick-video-template-shared";
import type { QuickVideoSlotRole } from "@/lib/quick-video-prompt";
import { PHOTO_FACE_REF_COUNT } from "@/lib/photo-refs-shared";

export type PhotoUiSlot = {
  role: QuickVideoSlotRole;
  label: string;
  file: File | null;
  previewUrl: string | null;
};

export function emptyPhotoIdentitySlots(): PhotoUiSlot[] {
  return Array.from({ length: PHOTO_FACE_REF_COUNT }, () => ({
    role: "identity" as QuickVideoSlotRole,
    label: "",
    file: null,
    previewUrl: null,
  }));
}

export async function buildPhotoIdentitySlotsFromBlueprint(
  blueprint: TemplateSlotBlueprint[],
  identityFiles: File[],
): Promise<PhotoUiSlot[]> {
  const next = emptyPhotoIdentitySlots();
  const file = identityFiles[0] || null;
  if (file) {
    next[0] = {
      role: "identity",
      label: blueprint.find((b) => b.role === "identity")?.label || "",
      file,
      previewUrl: URL.createObjectURL(file),
    };
  }
  return next;
}

export function PhotoRefSlotStrip({
  slots,
  onChange,
  onFillFromCharacter,
  fillBusy,
}: {
  slots: PhotoUiSlot[];
  onChange: (slots: PhotoUiSlot[]) => void;
  onFillFromCharacter?: () => void;
  fillBusy?: boolean;
}) {
  const [local, setLocal] = useState(slots);

  useEffect(() => {
    setLocal(slots);
  }, [slots]);

  function updateSlot(index: number, file: File | null) {
    const next = local.map((s, i) => {
      if (i !== index) return s;
      if (s.previewUrl) URL.revokeObjectURL(s.previewUrl);
      return {
        ...s,
        file,
        previewUrl: file ? URL.createObjectURL(file) : null,
      };
    });
    setLocal(next);
    onChange(next);
  }

  const hasIdentity = local[0]?.file;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-sm text-zinc-400">Фото лица (1 реф)</div>
          <p className="text-xs text-zinc-600">
            Krea Identity Edit берёт <strong>одно</strong> фото внешности. Поза и
            сцена — из шаблона (превью) + LEGO-промпт, не из этого снимка.
          </p>
        </div>
        {onFillFromCharacter ? (
          <button
            type="button"
            disabled={fillBusy}
            onClick={onFillFromCharacter}
            className="rounded-full border border-white/15 px-3 py-1 text-xs hover:border-peach/40"
          >
            {fillBusy ? "…" : "Из персонажа"}
          </button>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-2">
        {local.map((slot, index) => (
          <div
            key={index}
            className="flex w-[96px] flex-col gap-1 rounded-lg border border-white/10 bg-[#0c0c0e] p-1.5"
          >
            <div className="text-[10px] text-zinc-500">Лицо · Picture 1</div>
            <label className="relative flex h-[80px] w-[80px] cursor-pointer items-center justify-center overflow-hidden rounded border border-dashed border-white/15">
              {slot.previewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={slot.previewUrl}
                  alt=""
                  className="h-full w-full object-cover"
                />
              ) : (
                <span className="text-[10px] text-zinc-600">+ фото лица</span>
              )}
              <input
                type="file"
                accept="image/*"
                className="absolute inset-0 opacity-0"
                onChange={(e) =>
                  updateSlot(index, e.target.files?.[0] || null)
                }
              />
            </label>
          </div>
        ))}
      </div>
      {hasIdentity ? (
        <p className="text-xs text-emerald-500/90">
          Лицо готово — при шаблоне поза совпадёт с превью шаблона.
        </p>
      ) : null}
    </div>
  );
}

export function photoIdentitySlotsToFormMeta(slots: PhotoUiSlot[]) {
  if (!slots[0]?.file) return [];
  return [
    {
      pictureIndex: 1,
      role: "identity" as const,
      label: slots[0].label,
    },
  ];
}

export function useIdentityRefsReady(slots: PhotoUiSlot[]): boolean {
  return useMemo(() => !!slots[0]?.file, [slots]);
}
