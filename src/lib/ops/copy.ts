import { prisma } from "@/lib/db";
import { M, setI18nOverlay, type TgI18nKey } from "@/lib/tg/i18n";
import { setMediaOverlay, type TgMediaSlot } from "@/lib/tg/media-assets";

/** Funnel + help texts that are safe to edit from the cabinet. */
export const FUNNEL_SLOTS: { slot: TgI18nKey; title: string }[] = [
  { slot: "start_pitch", title: "Старт / выбор языка" },
  { slot: "rules_step", title: "Правила 18+" },
  { slot: "rules_agree_btn", title: "Кнопка согласия с правилами" },
  { slot: "welcome_after_rules", title: "Приветствие после правил" },
  { slot: "welcome_free_push", title: "Пуш через 30 секунд" },
  { slot: "onboard_pick_studio_btn", title: "Кнопка: готовый персонаж" },
  { slot: "onboard_create_char_btn", title: "Кнопка: создать свою модель" },
  { slot: "help_title", title: "Помощь" },
  { slot: "help_guide_btn", title: "Кнопка: инструкция" },
  { slot: "help_rules_btn", title: "Кнопка: политика/правила/оферта" },
  { slot: "help_support_btn", title: "Кнопка: поддержка" },
  { slot: "gen_insufficient", title: "Не хватает персиков" },
  { slot: "generating", title: "Генерация запущена" },
  { slot: "gen_error", title: "Ошибка генерации (человеку)" },
];

export const MEDIA_COPY_SLOTS: { slot: TgMediaSlot; title: string; dbSlot: string }[] =
  [
    { slot: "start", title: "Медиа на старте", dbSlot: "media_start" },
    { slot: "welcome", title: "Медиа приветствия", dbSlot: "media_welcome" },
    { slot: "photo_upload", title: "Медиа загрузки фото", dbSlot: "media_photo_upload" },
    { slot: "topup", title: "Медиа пополнения", dbSlot: "media_topup" },
  ];

let loaded = false;
let loadedAt = 0;
let plaverScrubbed = false;
const OVERLAY_TTL_MS = 15_000;

/** Drop leftover PlaVER watermark from seeded start_pitch once. */
async function scrubStartPitchPlaver() {
  if (plaverScrubbed) return;
  const row = await prisma.botCopy.findUnique({ where: { slot: "start_pitch" } });
  plaverScrubbed = true;
  if (!row) return;
  const has =
    /PlaVER/i.test(row.textRu || "") || /PlaVER/i.test(row.textEn || "");
  if (!has) return;
  await prisma.botCopy.update({
    where: { slot: "start_pitch" },
    data: {
      textRu: M.start_pitch.ru,
      textEn: M.start_pitch.en,
    },
  });
}

let helpCopySynced = false;

/** Force-sync help text + guide button from code (ops may still edit later). */
async function syncHelpCopyFromCode() {
  if (helpCopySynced) return;
  helpCopySynced = true;
  for (const slot of ["help_title", "help_guide_btn"] as const) {
    const d = M[slot];
    if (!d) continue;
    await prisma.botCopy.upsert({
      where: { slot },
      create: { slot, textRu: d.ru, textEn: d.en },
      update: { textRu: d.ru, textEn: d.en },
    });
  }
}

export async function loadCopyOverlay() {
  await scrubStartPitchPlaver();
  await syncHelpCopyFromCode();
  const rows = await prisma.botCopy.findMany();
  const textRows = rows
    .filter((r) => !r.slot.startsWith("media_"))
    .map((r) => ({ slot: r.slot, textRu: r.textRu, textEn: r.textEn }));
  setI18nOverlay(textRows);

  const media: Partial<Record<TgMediaSlot, string>> = {};
  for (const m of MEDIA_COPY_SLOTS) {
    const row = rows.find((r) => r.slot === m.dbSlot);
    if (row?.mediaUrl?.trim()) media[m.slot] = row.mediaUrl.trim();
  }
  setMediaOverlay(media);
  loaded = true;
  loadedAt = Date.now();
}

/** Load once, then refresh from DB so bot process picks up ops /copy edits. */
export async function ensureCopyOverlay() {
  if (!loaded || Date.now() - loadedAt > OVERLAY_TTL_MS) {
    await loadCopyOverlay();
  }
}

export async function seedFunnelCopy(defaults: Record<string, { ru: string; en: string }>) {
  for (const { slot } of FUNNEL_SLOTS) {
    const d = defaults[slot];
    if (!d) continue;
    await prisma.botCopy.upsert({
      where: { slot },
      create: { slot, textRu: d.ru, textEn: d.en },
      update: {},
    });
  }
  for (const m of MEDIA_COPY_SLOTS) {
    await prisma.botCopy.upsert({
      where: { slot: m.dbSlot },
      create: { slot: m.dbSlot, textRu: "", textEn: "", mediaUrl: "" },
      update: {},
    });
  }
  await loadCopyOverlay();
}
