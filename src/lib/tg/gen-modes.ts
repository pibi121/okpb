/** Shared labels for photo / video generation modes (mini-app + bot). */

export type FeedModeTab = "all" | "photo_look" | "video_one" | "video_look";
export type VideoPickMode = "one_photo" | "look";

export type ModeBadgeKind = "photo_look" | "video_one" | "video_look";

export function modeBadgeForTemplate(opts: {
  kind: "photo" | "video";
  requiresLora?: boolean;
  bestQuality?: boolean;
}): ModeBadgeKind {
  if (opts.kind === "photo") return "photo_look";
  if (opts.requiresLora || opts.bestQuality) return "video_look";
  return "video_one";
}

export function matchesFeedModeTab(
  tab: FeedModeTab,
  opts: { kind: "photo" | "video"; requiresLora?: boolean; bestQuality?: boolean },
): boolean {
  if (tab === "all") return true;
  const mode = modeBadgeForTemplate(opts);
  if (tab === "photo_look") return mode === "photo_look";
  if (tab === "video_one") return mode === "video_one";
  return mode === "video_look";
}

export const MODE_LABELS = {
  ru: {
    photo_look: "Фото по образу",
    video_one: "Видео по 1 фото",
    video_look: "Видео по образу",
    maxQuality: "Макс. качество",
    tabAll: "Все",
    needPhoto: "Нужна модель из витрины или своя",
    needVideoOne: "Достаточно 1 фото",
    needVideoLook: "Нужна обученная модель",
  },
  en: {
    photo_look: "Photo by look",
    video_one: "Video from 1 photo",
    video_look: "Video by look",
    maxQuality: "Max quality",
    tabAll: "All",
    needPhoto: "Needs a studio or your trained look",
    needVideoOne: "Just 1 photo is enough",
    needVideoLook: "Needs a trained model",
  },
} as const;

export function modeNeedLine(
  locale: "ru" | "en",
  kind: ModeBadgeKind,
): string {
  const u = MODE_LABELS[locale];
  if (kind === "photo_look") return u.needPhoto;
  if (kind === "video_one") return u.needVideoOne;
  return u.needVideoLook;
}
