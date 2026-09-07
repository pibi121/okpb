import {
  tgSendAnimation,
  tgSendMessage,
  tgSendPhoto,
  tgSendVideo,
} from "@/lib/tg/telegram-api";
import { resolveTgCatalogAssetUrl } from "@/lib/tg/catalog-asset-url";
import { publicSiteBaseUrl } from "@/lib/tg/public-site-url";

/** Bundled onboarding / top-up media in `public/tg/media/`. */
export type TgMediaSlot = "start" | "welcome" | "photo_upload" | "topup";

const mediaOverlay: Partial<Record<TgMediaSlot, string>> = {};

export function setMediaOverlay(map: Partial<Record<TgMediaSlot, string>>) {
  for (const k of Object.keys(mediaOverlay) as TgMediaSlot[]) {
    delete mediaOverlay[k];
  }
  Object.assign(mediaOverlay, map);
}

const ENV: Record<TgMediaSlot, string> = {
  start: "TG_VIDEO_START",
  welcome: "TG_VIDEO_WELCOME",
  photo_upload: "TG_GIF_PHOTO_UPLOAD",
  topup: "TG_GIF_TOPUP",
};

/** Default static files (override via env with file_id or URL). */
const BUNDLED: Record<TgMediaSlot, string> = {
  start: "/tg/media/onboard-1.mp4",
  welcome: "/tg/media/onboard-2.mp4",
  photo_upload: "/tg/media/onboard-3.jpg",
  topup: "/tg/media/topup.jpg",
};

export function tgSiteBaseUrl(): string {
  // Mini App URL is often …/tg or …/tg/templates — site root must not keep /tg
  // or covers become /tg/tg/catalog/… (404).
  return publicSiteBaseUrl();
}

export function tgAbsoluteUrl(pathOrUrl: string): string {
  // Always normalize catalog paths first (incl. absolute /api/media cast URLs).
  const fixed = resolveTgCatalogAssetUrl(pathOrUrl) || pathOrUrl.trim();
  if (/^https?:\/\//i.test(fixed)) return fixed;
  const base = tgSiteBaseUrl();
  return fixed.startsWith("/") ? `${base}${fixed}` : `${base}/${fixed}`;
}

export function tgMediaAsset(slot: TgMediaSlot): string {
  const fromCabinet = mediaOverlay[slot]?.trim();
  if (fromCabinet) return fromCabinet;
  const legacy =
    slot === "start"
      ? process.env.TG_GIF_START?.trim()
      : slot === "welcome"
        ? process.env.TG_GIF_WELCOME?.trim()
        : undefined;
  const fromEnv = process.env[ENV[slot]]?.trim() || legacy;
  if (fromEnv) return fromEnv;
  return tgAbsoluteUrl(BUNDLED[slot]);
}

function isGifMedia(media: string): boolean {
  if (media.startsWith("Cg")) return true;
  return /\.gif(\?|$)/i.test(media);
}

function isVideoMedia(media: string): boolean {
  return /\.(mp4|webm|mov)(\?|$)/i.test(media);
}

/** Send text with bundled/env photo, video, or GIF (file_id or URL). */
export async function tgSendMediaMessage(
  chatId: number,
  slot: TgMediaSlot,
  text: string,
  extra: Record<string, unknown> = {},
) {
  const media = tgMediaAsset(slot);
  if (isVideoMedia(media)) {
    return tgSendVideo(chatId, media, text, extra);
  }
  if (isGifMedia(media)) {
    return tgSendAnimation(chatId, media, {
      caption: text,
      parse_mode: "HTML",
      ...extra,
    });
  }
  return tgSendPhoto(chatId, media, text, extra);
}

/** Photo/video preview with caption (e.g. template confirm). */
export async function tgSendPreviewMessage(
  chatId: number,
  previewUrl: string | null | undefined,
  text: string,
  extra: Record<string, unknown> = {},
) {
  if (!previewUrl) {
    return tgSendMessage(chatId, text, extra);
  }
  const url = tgAbsoluteUrl(previewUrl);
  if (isVideoMedia(url)) {
    await tgSendVideo(chatId, url, text, extra);
    return;
  }
  return tgSendPhoto(chatId, url, text, extra);
}
