/**
 * Deliver photo/video to Telegram without relying on public HTTP fetch.
 *
 * User gallery lives under /api/media/{userId}/… and returns 401 without a
 * session — Telegram's sendPhoto/sendVideo by URL always fails with
 * "failed to get HTTP URL content". Upload bytes via multipart instead.
 */
import { localBytesFromResultUrl } from "@/lib/peach-lab";
import { publicSiteBaseUrl } from "@/lib/tg/public-site-url";
import { tgAbsoluteUrl } from "@/lib/tg/media-assets";
import {
  tgSendPhoto,
  tgSendPhotoFile,
  tgSendVideo,
  tgSendVideoFile,
} from "@/lib/tg/telegram-api";

/** Path Telegram / our app can use: /api/media/… or /tg/… */
export function mediaRelativePath(pathOrUrl: string): string | null {
  const raw = (pathOrUrl || "").trim();
  if (!raw) return null;
  if (raw.startsWith("/api/media/") || raw.startsWith("/tg/")) {
    return raw.split("?")[0] || null;
  }
  try {
    const u = new URL(raw);
    if (u.pathname.startsWith("/api/media/") || u.pathname.startsWith("/tg/")) {
      return u.pathname;
    }
  } catch {
    /* ignore */
  }
  const base = publicSiteBaseUrl().replace(/\/$/, "");
  if (base && raw.startsWith(base)) {
    const p = raw.slice(base.length).split("?")[0] || "";
    if (p.startsWith("/api/media/") || p.startsWith("/tg/")) return p;
  }
  return null;
}

/** Private user gallery — Telegram cannot HTTP-fetch these URLs. */
export function isPrivateGalleryPath(pathOrUrl: string): boolean {
  const rel = mediaRelativePath(pathOrUrl) || pathOrUrl.trim();
  return (
    rel.startsWith("/api/media/") && !rel.startsWith("/api/media/tg-catalog/")
  );
}

function filenameFromPath(pathOrUrl: string, fallback: string): string {
  const rel = mediaRelativePath(pathOrUrl) || pathOrUrl;
  const base = rel.split("/").pop()?.split("?")[0] || fallback;
  return base.includes(".") ? base : fallback;
}

export async function tgDeliverPhoto(opts: {
  chatId: number | string;
  url: string;
  caption?: string;
  extra?: Record<string, unknown>;
  token?: string;
}): Promise<void> {
  const rel = mediaRelativePath(opts.url);
  const bytes = rel ? localBytesFromResultUrl(rel) : null;
  if (bytes?.length) {
    await tgSendPhotoFile(
      opts.chatId,
      bytes,
      filenameFromPath(opts.url, "photo.jpg"),
      opts.caption,
      opts.extra || {},
      opts.token,
    );
    return;
  }
  if (isPrivateGalleryPath(opts.url)) {
    throw new Error(
      "media_unavailable: private gallery file missing on disk",
    );
  }
  await tgSendPhoto(
    opts.chatId,
    tgAbsoluteUrl(opts.url),
    opts.caption,
    opts.extra || {},
    opts.token,
  );
}

export async function tgDeliverVideo(opts: {
  chatId: number | string;
  url: string;
  caption?: string;
  extra?: Record<string, unknown>;
  token?: string;
}): Promise<void> {
  const rel = mediaRelativePath(opts.url);
  const bytes = rel ? localBytesFromResultUrl(rel) : null;
  if (bytes?.length) {
    await tgSendVideoFile(
      opts.chatId,
      bytes,
      filenameFromPath(opts.url, "video.mp4"),
      opts.caption,
      opts.extra || {},
      opts.token,
    );
    return;
  }
  if (isPrivateGalleryPath(opts.url)) {
    throw new Error(
      "media_unavailable: private gallery file missing on disk",
    );
  }
  await tgSendVideo(
    opts.chatId,
    tgAbsoluteUrl(opts.url),
    opts.caption,
    opts.extra || {},
    opts.token,
  );
}

/** Permanent Telegram fetch failures — do not retry forever. */
export function isPermanentOutboxMediaError(message: string): boolean {
  return /failed to get HTTP URL content|wrong type of the web page content|failed to get http url content|media_unavailable|WEBPAGE_MEDIA_EMPTY|WEBPAGE_CURL_FAILED|wrong file identifier|failed to send message #?photo|failed to send message #?video|failed to send message #\d+/i.test(
    message,
  );
}
