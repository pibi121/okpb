export type NavLink = {
  href: string;
  label: string;
  exact?: boolean;
};

/** Меню для обычного пользователя (ТЗ ПБ1) */
export const USER_NAV: NavLink[] = [
  { href: "/peach", label: "Обзор", exact: true },
  { href: "/peach/photo", label: "Фото" },
  { href: "/peach/video", label: "Видео" },
  { href: "/peach/gallery", label: "Галерея" },
  { href: "/peach/characters", label: "Персонажи" },
];

/** Dev / lab 1.0 — режим «Лаборатория» (Как вижу я) */
export const ADMIN_NAV: NavLink[] = [
  { href: "/peach/tg-catalog", label: "TG каталог" },
  { href: "/peach/tg-photo", label: "TG фото (тест)" },
  { href: "/peach/photo-edit", label: "Photo Edit Lab" },
  { href: "/peach/tease-lab", label: "Tease Lab" },
  { href: "/peach/lora-i2v", label: "LoRA → I2V" },
  { href: "/peach/story-video", label: "Story H3 видео" },
  { href: "/peach/video-lego", label: "Video LEGO" },
  { href: "/peach/quick-video", label: "Быстрое видео" },
  { href: "/peach/pose-eval", label: "Pose eval" },
  { href: "/peach/eros-eval", label: "Eros eval" },
  { href: "/peach/tester", label: "Тестер" },
  { href: "/peach/tests", label: "Галерея тестов" },
  { href: "/peach/templates", label: "Шаблоны (legacy)" },
  { href: "/peach/presets", label: "Пресеты" },
  { href: "/peach/social", label: "Social (admin)" },
  { href: "/peach/video/legacy", label: "Video legacy" },
  { href: "/peach/stories", label: "Stories" },
];

/**
 * Lab 2.0 — только разделы под новую TG-воронку (позы / видео / tease / каталог).
 * Старые eval/legacy сюда не тащим.
 */
export const LAB2_NAV: NavLink[] = [
  { href: "/peach/lab2", label: "Обзор 2.0", exact: true },
  { href: "/peach/photo-edit", label: "Позы (новый Edit)" },
  { href: "/peach/tg-photo", label: "TG фото-шаблоны" },
  { href: "/peach/tg-catalog", label: "TG каталог" },
  { href: "/peach/tease-lab", label: "Tease (blur)" },
  { href: "/peach/story-video", label: "Видео по 1 фото" },
  { href: "/peach/lora-i2v", label: "Сюжет I2V (1 фото)" },
  { href: "/peach/gallery", label: "Галерея" },
  { href: "/peach/characters", label: "Персонажи (PRO)" },
];

/** All peach paths that require labAccess (Lab 1 + Lab 2 hubs). */
export const ALL_LAB_HREFS: string[] = [
  ...ADMIN_NAV.map((l) => l.href),
  ...LAB2_NAV.map((l) => l.href),
  "/peach/lab2",
];

export function displayUserName(name: string | null, email: string): string {
  if (name?.trim()) return name.trim();
  const local = email.split("@")[0] || "user";
  const word = local.replace(/[^a-zA-Zа-яА-Я0-9]/g, "").slice(0, 8) || "peach";
  const tail = Math.abs(hashStr(email)) % 9000 + 1000;
  return `${word}${tail}`;
}

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}
