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
