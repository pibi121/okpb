export const PHOTO_SCENE_CATEGORIES = [
  { id: "sex", ru: "Секс", en: "Sex" },
  { id: "display", ru: "Демонстрация", en: "Display" },
  { id: "dirt", ru: "Грязь", en: "Messy" },
  { id: "public", ru: "Публичное место", en: "Public" },
  { id: "humiliation", ru: "Унижение", en: "Humiliation" },
] as const;

export type PhotoSceneCategoryId =
  (typeof PHOTO_SCENE_CATEGORIES)[number]["id"];

const SCENE_ID_SET = new Set(
  PHOTO_SCENE_CATEGORIES.map((c) => c.id as string),
);

/** Parse stored categories: "sex,display" or legacy single id. */
export function parsePhotoSceneCategories(
  raw?: string | null,
): PhotoSceneCategoryId[] {
  if (!raw?.trim()) return [];
  const out: PhotoSceneCategoryId[] = [];
  for (const part of raw.split(/[,|;]+/)) {
    const id = part.trim().toLowerCase();
    if (SCENE_ID_SET.has(id) && !out.includes(id as PhotoSceneCategoryId)) {
      out.push(id as PhotoSceneCategoryId);
    }
  }
  return out;
}

export function formatPhotoSceneCategories(ids: readonly string[]): string {
  const clean = ids
    .map((id) => id.trim().toLowerCase())
    .filter((id) => SCENE_ID_SET.has(id));
  return [...new Set(clean)].join(",");
}

export function photoMatchesSceneCategory(
  raw: string | undefined | null,
  category: string,
): boolean {
  if (!category) return true;
  return parsePhotoSceneCategories(raw).includes(
    category as PhotoSceneCategoryId,
  );
}

export function guessPhotoSceneCategory(title: string): PhotoSceneCategoryId | "" {
  const t = title.toLowerCase();
  if (/униж|унижен|spit|slap|humili/i.test(t)) return "humiliation";
  if (/двор|улиц|парков|обществен|public|balcony|лифт/i.test(t)) return "public";
  if (/гряз|сперм|cum|creampie|слюн|моч/i.test(t)) return "dirt";
  if (/секс|минет|член|еб[её]|трах|sex|blow|fuck|titjob|oral/i.test(t)) return "sex";
  if (/попк|сиськ|показ|демонстр|nude|flash|разде/i.test(t)) return "display";
  return "";
}

export function shuffleInPlace<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr;
}

/**
 * Random order each visit: mix photo/video (video, photo, video…)
 * and avoid two consecutive items with the same identity when possible.
 */
export function orderFeedMixed<T extends { kind: string; identityKey: string }>(
  items: T[],
): T[] {
  const photos = shuffleInPlace(items.filter((i) => i.kind === "photo"));
  const videos = shuffleInPlace(items.filter((i) => i.kind === "video"));
  const out: T[] = [];
  let wantVideo = Math.random() < 0.5;

  const take = (arr: T[], lastId?: string) => {
    if (!arr.length) return undefined;
    const idx = lastId
      ? arr.findIndex((x) => x.identityKey && x.identityKey !== lastId)
      : 0;
    return arr.splice(idx >= 0 ? idx : 0, 1)[0];
  };

  while (photos.length || videos.length) {
    const primary = wantVideo ? videos : photos;
    const other = wantVideo ? photos : videos;
    const lastId = out[out.length - 1]?.identityKey;
    const picked = take(primary, lastId) || take(other, lastId);
    if (picked) out.push(picked);
    wantVideo = !wantVideo;
  }
  return out;
}

/** Newest first, top → bottom (stable tie-break by id). */
export function orderFeedNewest<
  T extends { createdAt: number; id?: string },
>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const d = b.createdAt - a.createdAt;
    if (d !== 0) return d;
    return String(b.id || "").localeCompare(String(a.id || ""));
  });
}
