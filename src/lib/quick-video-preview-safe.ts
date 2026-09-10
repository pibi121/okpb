/** Pure URL checks for video template thumbs — safe for client + server. */

/** Marker in saved thumb filenames — only these may be shown to TG users. */
export const TEMPLATE_PREVIEW_PREFIX = "qv_tpl_thumb";

/** True only for thumbs extracted from the result video (never refs). */
export function isSafeVideoTemplateThumb(
  url: string | null | undefined,
): boolean {
  const u = (url || "").trim();
  if (!u) return false;
  if (u.includes(TEMPLATE_PREVIEW_PREFIX)) return true;
  if (/\/(?:api\/media\/)?tg-catalog\/qv-[^/]+-frame-thumb\./i.test(u)) {
    return true;
  }
  if (/\/tg\/catalog\/qv-[^/]+-frame-thumb\./i.test(u)) return true;
  if (/\/tg\/catalog\/video-\d+-thumb\./i.test(u)) return true;
  return false;
}

/** Still image usable as a catalog poster (not a video file). */
export function isCatalogStillUrl(url: string | null | undefined): boolean {
  const u = (url || "").trim();
  if (!u) return false;
  if (/\.(mp4|webm|mov)(\?|$)/i.test(u)) return false;
  if (/\.(png|jpe?g|webp|gif|avif)(\?|$)/i.test(u)) return true;
  // Volume / media paths without extension heuristics — allow non-video catalog stills.
  if (/\/(?:api\/media\/)?tg-catalog\//i.test(u) && !/\.(mp4|webm|mov)/i.test(u)) {
    return true;
  }
  if (/^https?:\/\//i.test(u) && !/\.(mp4|webm|mov)/i.test(u)) return true;
  if (u.startsWith("/") && !/\.(mp4|webm|mov)/i.test(u)) return true;
  return false;
}

/**
 * Prefer a frame-extracted safe thumb; otherwise any still so Mini App never
 * ships an empty poster (black WebView hole).
 */
export function pickCatalogPosterUrl(
  ...candidates: Array<string | null | undefined>
): string {
  const list = candidates.map((c) => (c || "").trim()).filter(Boolean);
  for (const u of list) {
    if (isSafeVideoTemplateThumb(u)) return u;
  }
  for (const u of list) {
    if (isCatalogStillUrl(u)) return u;
  }
  return "";
}
