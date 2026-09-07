/** Shared TG launch catalog constants (no DB imports). */

export const TG_FEATURED_VIDEO_TITLES = [
  "Сосёт + кончает на лицо #1",
  "Снимает верхнюю одежду",
] as const;

export const TG_FEATURED_PHOTO_TITLES = ["Член во рту #1"] as const;

export const TG_STUDIO_CAST_NAMES = (
  process.env.TG_STUDIO_CAST_NAMES?.trim() ||
  "Daisy Shtorm,Маша,Лора"
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

export const TG_STUDIO_CAST_TRIGGERS = (
  process.env.TG_STUDIO_CAST_TRIGGERS?.trim() ||
  "daisysh,masha1,olh_person"
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

export const TG_STUDIO_CAST_SPEC: Array<{
  displayName: string;
  names: string[];
  triggers: string[];
}> = [
  {
    displayName: "Daisy Shtorm",
    names: ["Daisy Shtorm", "Daisy"],
    triggers: ["daisysh"],
  },
  { displayName: "Маша", names: ["Маша", "Masha"], triggers: ["masha1"] },
  { displayName: "Лора", names: ["Лора", "Lora"], triggers: ["olh_person"] },
];
