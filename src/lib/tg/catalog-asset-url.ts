/**
 * TG catalog assets:
 * - Runtime videos (`qv-*`, `li2v-*`) live on the Railway volume → `/api/media/tg-catalog/…`
 *   (Next static `/tg/catalog/qv-*.mp4` 404s even when readdir sees the file).
 * - Seed images shipped in the image (`cast-daisysh`, `video-1`, …) → `/tg/catalog/…`
 * - Published cast covers survive on the volume; public/ is wiped on redeploy → prefer
 *   `/api/media/tg-catalog/…` when the file is only on volume.
 */
import fs from "fs";
import path from "path";
import { galleryRoot } from "@/lib/paths";

const SEED_IMAGE_RE =
  /^(video-\d+-thumb|photo-\d+|cast-daisysh|cast-masha1|cast-olh_person)\.(png|jpe?g|webp)$/i;

const SEED_VIDEO_RE = /^video-\d+\.(mp4|webm|mov)$/i;

/** Volume-backed previews that must use the media API (with HTTP Range). */
const VOLUME_ASSET_RE =
  /^(qv-|li2v-).+\.(mp4|webm|mov|png|jpe?g|webp)$/i;

function catalogFileName(url: string): string {
  return (
    url.match(/\/(?:tg\/catalog|api\/media\/tg-catalog)\/([^/?#]+)/i)?.[1] ||
    ""
  );
}

/** Strip our own absolute origin so DB/absolute covers still normalize. */
function toRelativeCatalogPath(url: string): string {
  const abs = url.match(
    /^https?:\/\/[^/]+(\/(?:tg\/catalog|api\/media\/tg-catalog)\/[^?#]+)/i,
  );
  if (abs?.[1]) return abs[1];
  return url;
}

function publicCatalogPath(name: string): string {
  return path.join(process.cwd(), "public", "tg", "catalog", name);
}

function volumeCatalogPath(name: string): string {
  return path.join(galleryRoot(), "tg-catalog", name);
}

/** Prefer static public for seed art; runtime cast covers always use media API.
 * Next.js does not serve files written into `public/` after the image is built,
 * so published `cast-{cuid}.*` covers on the volume must use `/api/media/…`.
 */
export function resolveCatalogImageUrl(name: string): string {
  if (SEED_IMAGE_RE.test(name)) {
    if (fs.existsSync(publicCatalogPath(name))) {
      return `/tg/catalog/${name}`;
    }
    if (fs.existsSync(volumeCatalogPath(name))) {
      return `/api/media/tg-catalog/${name}`;
    }
    return `/tg/catalog/${name}`;
  }

  // Published cast / photo stills (and any non-seed catalog image).
  if (/^cast-/i.test(name) || /^photo-/i.test(name) || VOLUME_ASSET_RE.test(name)) {
    return `/api/media/tg-catalog/${name}`;
  }

  if (fs.existsSync(volumeCatalogPath(name))) {
    return `/api/media/tg-catalog/${name}`;
  }
  if (fs.existsSync(publicCatalogPath(name))) {
    return `/tg/catalog/${name}`;
  }
  return `/api/media/tg-catalog/${name}`;
}

export function resolveTgCatalogAssetUrl(
  url: string | null | undefined,
): string {
  const rawIn = (url || "").trim();
  if (!rawIn) return "";

  const raw = toRelativeCatalogPath(rawIn);
  if (/^https?:\/\//i.test(raw)) return raw;

  const name = catalogFileName(raw);
  if (!name) return raw;

  if (SEED_VIDEO_RE.test(name) || SEED_IMAGE_RE.test(name)) {
    // Seeds: static when present; volume fallback for mirrored copies.
    return resolveCatalogImageUrl(name);
  }

  // Runtime video (+ frame thumbs): always media API
  if (VOLUME_ASSET_RE.test(name) || /\.(mp4|webm|mov)$/i.test(name)) {
    return `/api/media/tg-catalog/${name}`;
  }

  // Cast / photo stills: public if present, else volume
  if (/^cast-/i.test(name) || /^photo-/i.test(name)) {
    return resolveCatalogImageUrl(name);
  }

  return `/api/media/tg-catalog/${name}`;
}
