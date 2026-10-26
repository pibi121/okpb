/**
 * Pose constructor catalog. Prompts live in data/pose-prompts.json.
 * Picture 1 = girl (replaced). Picture 2 = man or the baked default.
 * Pictures 3–5 stay on the pose GPU input folder.
 */
import { premiumVideoPeaches } from "@/lib/tg-pricing";
import prompts from "@/lib/pose-constructor/prompts.json";

export const POSE_CLIP_SEC = 5;
export const POSE_WIDTH = 1376;
export const POSE_HEIGHT = 768;
export const POSE_LENGTH = 124;

export const POSE_DEFAULT_MAN =
  "55d7ad2b955b5b2921458361724d5d0c_e494be6c-f298-4ce7-8e47-8d7b515d2499.png";
export const POSE_BAKED_REFS = [
  "1749107877_mbj1m7lz-p-63-selfies-of-guys.webp",
  "Снимок экрана 2026-10-24 075958.png",
  "36b9fcc44dc686369e0945c15b74cdb8_9674cf1e-1e47-4f76-befb-5535f7bb6660.png",
] as const;

export const POSE_CODEWORD = "POSE_BUILDER_9K2M";

export type PoseDef = {
  id: string;
  title: string;
};

export const POSE_DEFS: PoseDef[] = [
  { id: "kiss", title: "Поцелуй" },
  { id: "bj_side", title: "Минет (сбоку)" },
  { id: "bj_pov", title: "Минет от 1 лица" },
  { id: "bj_hand", title: "Сосёт и дрочит" },
  { id: "bj_cum", title: "Кончил на лицо" },
  { id: "doggy_pov", title: "Раком от 1 лица" },
  { id: "doggy_side", title: "Раком (сбоку)" },
  { id: "doggy_cum", title: "Кончил на попку" },
  { id: "prone", title: "На животе" },
  { id: "missionary", title: "Классика (миссионер)" },
];

export function poseById(id: string): PoseDef | null {
  return POSE_DEFS.find((p) => p.id === id) || null;
}

export function posePrompt(id: string): string {
  const text = (prompts[id as keyof typeof prompts] || "").trim();
  if (!text) throw new Error(`Нет промпта позы ${id}`);
  return text;
}

export function posePriceRub(): number {
  return premiumVideoPeaches(POSE_CLIP_SEC);
}

export function poseOrderPrice(ids: string[]): { sec: number; rub: number } {
  const n = ids.length;
  return { sec: n * POSE_CLIP_SEC, rub: n * posePriceRub() };
}
