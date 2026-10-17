/**
 * Deliver photo/video to Telegram without relying on public HTTP fetch.
 *
 * User gallery lives under /api/media/{userId}/… and returns 401 without a
 * session — Telegram's sendPhoto/sendVideo by URL always fails with
 * "failed to get HTTP URL content". Upload bytes via multipart instead.
 *
 * After a successful video upload, persist Telegram `file_id` on the gallery
 * item so resends reuse the CDN copy and skip Railway egress of the mp4.
 */
import { prisma } from "@/lib/db";
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

export type TgDeliverResult = {
  message_id?: number;
  file_id?: string;
};

function extractTgVideoFileId(result: unknown): string | undefined {
  if (!result || typeof result !== "object") return undefined;
  const r = result as {
    video?: { file_id?: string };
    document?: { file_id?: string; mime_type?: string };
    animation?: { file_id?: string };
  };
  if (typeof r.video?.file_id === "string" && r.video.file_id.trim()) {
    return r.video.file_id.trim();
  }
  if (
    typeof r.document?.file_id === "string" &&
    r.document.file_id.trim() &&
    /video/i.test(r.document.mime_type || "video")
  ) {
    return r.document.file_id.trim();
  }
  if (typeof r.animation?.file_id === "string" && r.animation.file_id.trim()) {
    return r.animation.file_id.trim();
  }
  return undefined;
}

async function loadGalleryTgVideoFileId(
  galleryItemId: string,
): Promise<string | undefined> {
  try {
    const gi = await prisma.galleryItem.findUnique({
      where: { id: galleryItemId },
      select: { metaJson: true },
    });
    const meta = JSON.parse(gi?.metaJson || "{}") as {
      tgVideoFileId?: unknown;
    };
    const id = typeof meta.tgVideoFileId === "string" ? meta.tgVideoFileId.trim() : "";
    return id || undefined;
  } catch {
    return undefined;
  }
}

async function persistGalleryTgVideoFileId(
  galleryItemId: string,
  fileId: string,
): Promise<void> {
  try {
    const gi = await prisma.galleryItem.findUnique({
      where: { id: galleryItemId },
      select: { metaJson: true },
    });
    if (!gi) return;
    const meta = JSON.parse(gi.metaJson || "{}") as Record<string, unknown>;
    if (meta.tgVideoFileId === fileId) return;
    await prisma.galleryItem.update({
      where: { id: galleryItemId },
      data: {
        metaJson: JSON.stringify({
          ...meta,
          tgVideoFileId: fileId,
          tgVideoFileIdAt: new Date().toISOString(),
        }),
      },
    });
  } catch (e) {
    console.warn(
      "[peach] persist tgVideoFileId failed:",
      e instanceof Error ? e.message : e,
    );
  }
}

function isStaleTgFileIdError(message: string): boolean {
  return /wrong file identifier|FILE_ID_INVALID|file is too big|failed to get file|VIDEO_CONTENT_TYPE_INVALID/i.test(
    message,
  );
}

export async function tgDeliverPhoto(opts: {
  chatId: number | string;
  url: string;
  caption?: string;
  extra?: Record<string, unknown>;
  token?: string;
}): Promise<TgDeliverResult | undefined> {
  const rel = mediaRelativePath(opts.url);
  const bytes = rel ? localBytesFromResultUrl(rel) : null;
  if (bytes?.length) {
    return (await tgSendPhotoFile(
      opts.chatId,
      bytes,
      filenameFromPath(opts.url, "photo.jpg"),
      opts.caption,
      opts.extra || {},
      opts.token,
    )) as TgDeliverResult;
  }
  if (isPrivateGalleryPath(opts.url)) {
    throw new Error(
      "media_unavailable: private gallery file missing on disk",
    );
  }
  return (await tgSendPhoto(
    opts.chatId,
    tgAbsoluteUrl(opts.url),
    opts.caption,
    opts.extra || {},
    opts.token,
  )) as TgDeliverResult;
}

export async function tgDeliverVideo(opts: {
  chatId: number | string;
  url: string;
  caption?: string;
  extra?: Record<string, unknown>;
  token?: string;
  /** When set, load/store Telegram file_id on this gallery item. */
  galleryItemId?: string;
  /** Explicit file_id (skips gallery lookup). */
  fileId?: string;
}): Promise<TgDeliverResult | undefined> {
  const { telegramVideoSizeExtra } = await import("@/lib/tg/mp4-probe");
  const galleryItemId = opts.galleryItemId?.trim() || "";
  let fileId = (opts.fileId || "").trim();
  if (!fileId && galleryItemId) {
    fileId = (await loadGalleryTgVideoFileId(galleryItemId)) || "";
  }

  if (fileId) {
    try {
      const result = (await tgSendVideo(
        opts.chatId,
        fileId,
        opts.caption,
        opts.extra || {},
        opts.token,
      )) as TgDeliverResult;
      return { ...result, file_id: fileId };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!isStaleTgFileIdError(msg)) throw e;
      console.warn(
        `[peach] tg file_id stale for ${galleryItemId || "n/a"} — re-upload`,
        msg.slice(0, 120),
      );
      fileId = "";
    }
  }

  const rel = mediaRelativePath(opts.url);
  const bytes = rel ? localBytesFromResultUrl(rel) : null;
  const extra = telegramVideoSizeExtra(bytes, opts.extra || {});
  if (bytes?.length) {
    const result = (await tgSendVideoFile(
      opts.chatId,
      bytes,
      filenameFromPath(opts.url, "video.mp4"),
      opts.caption,
      extra,
      opts.token,
    )) as TgDeliverResult;
    const newId = extractTgVideoFileId(result);
    if (newId && galleryItemId) {
      await persistGalleryTgVideoFileId(galleryItemId, newId);
    }
    return { ...result, file_id: newId };
  }
  if (isPrivateGalleryPath(opts.url)) {
    throw new Error(
      "media_unavailable: private gallery file missing on disk",
    );
  }
  // URL fallback: bust Telegram's per-URL media cache when file content changes.
  const abs = tgAbsoluteUrl(opts.url);
  const bust = abs.includes("?")
    ? `${abs}&v=${Date.now()}`
    : `${abs}?v=${Date.now()}`;
  const result = (await tgSendVideo(
    opts.chatId,
    bust,
    opts.caption,
    extra,
    opts.token,
  )) as TgDeliverResult;
  const newId = extractTgVideoFileId(result);
  if (newId && galleryItemId) {
    await persistGalleryTgVideoFileId(galleryItemId, newId);
  }
  return { ...result, file_id: newId };
}

/** Permanent Telegram fetch failures — do not retry forever. */
export function isPermanentOutboxMediaError(message: string): boolean {
  return /failed to get HTTP URL content|wrong type of the web page content|failed to get http url content|media_unavailable|WEBPAGE_MEDIA_EMPTY|WEBPAGE_CURL_FAILED|wrong file identifier|failed to send message #?photo|failed to send message #?video|failed to send message #\d+/i.test(
    message,
  );
}
