"use client";

import {
  KREA_SKIN_DETAIL_DEFAULT_STRENGTH,
  KREA_SKIN_DETAIL_STRENGTH_MAX,
} from "@/lib/krea-skin-lora";

export function SkinDetailControls({
  enabled,
  strength,
  onEnabledChange,
  onStrengthChange,
}: {
  enabled: boolean;
  strength: number;
  onEnabledChange: (v: boolean) => void;
  onStrengthChange: (v: number) => void;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-md border border-zinc-200 px-3 py-2">
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => onEnabledChange(e.target.checked)}
        />
        <span>
          Skin detail LoRA
          <span className="text-zinc-500">
            {" "}
            — текстура кожи (Krea2, clip=0)
          </span>
        </span>
      </label>
      <label
        className={`flex flex-col gap-1 text-sm ${enabled ? "" : "opacity-50"}`}
      >
        <span>
          Сила: <strong>{enabled ? strength.toFixed(1) : "—"}</strong>
          <span className="text-zinc-500">
            {" "}
            · рекомендуется {KREA_SKIN_DETAIL_DEFAULT_STRENGTH}–2.0
          </span>
        </span>
        <input
          type="range"
          min={0.5}
          max={KREA_SKIN_DETAIL_STRENGTH_MAX}
          step={0.1}
          disabled={!enabled}
          value={strength}
          onChange={(e) => onStrengthChange(Number(e.target.value))}
          className="w-full"
        />
      </label>
    </div>
  );
}

export const SKIN_DETAIL_DEFAULT_ENABLED = true;
export const SKIN_DETAIL_DEFAULT_STRENGTH = KREA_SKIN_DETAIL_DEFAULT_STRENGTH;
