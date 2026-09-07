/** Тарифные пакеты — docs/ECONOMICS-APPROVED.md (peaches = кредиты в UI) */

export type PlanId = "sprout" | "seed" | "bloom" | "orchard" | "vault";

export type PeachPlan = {
  id: PlanId;
  name: string;
  priceUsd: number;
  peaches: number;
  bonusLabel: string;
  characters: string;
  privacy: string;
  highlight?: boolean;
};

export const PEACH_PLANS: PeachPlan[] = [
  {
    id: "sprout",
    name: "Sprout",
    priceUsd: 0,
    peaches: 100,
    bonusLabel: "разово, без пополнения",
    characters: "1 персонаж (лукбук)",
    privacy: "только публичные → шаблоны",
  },
  {
    id: "seed",
    name: "Seed",
    priceUsd: 15,
    peaches: 1800,
    bonusLabel: "+20% к базе",
    characters: "1 лукбук (+ faceswap за peaches)",
    privacy: "публичные → шаблоны",
    highlight: true,
  },
  {
    id: "bloom",
    name: "Bloom",
    priceUsd: 39,
    peaches: 5000,
    bonusLabel: "+28%",
    characters: "1 LoRA + 2 лукбука",
    privacy: "public + hidden, opt-out поста",
  },
  {
    id: "orchard",
    name: "Orchard",
    priceUsd: 99,
    peaches: 13500,
    bonusLabel: "+36%",
    characters: "3 LoRA + 5 лукбуков",
    privacy: "private, без автошаблонов",
  },
  {
    id: "vault",
    name: "Vault",
    priceUsd: 199,
    peaches: 28000,
    bonusLabel: "+40%",
    characters: "5 LoRA + безлимит лукбуков*",
    privacy: "полная приватность",
  },
];

export const TOP_UP_PACKS = [
  { usd: 5, peaches: 500, bonus: null },
  { usd: 20, peaches: 2200, bonus: "+10%" },
  { usd: 50, peaches: 6000, bonus: "+20%" },
] as const;

export function planById(id: PlanId): PeachPlan {
  return PEACH_PLANS.find((p) => p.id === id) ?? PEACH_PLANS[0];
}

/** Пока нет planId в БД — дефолт для UI */
export const DEFAULT_PLAN_ID: PlanId = "sprout";
