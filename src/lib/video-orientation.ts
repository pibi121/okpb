/**
 * Shared video/still aspect presets for MiniMax, Krea, Ref2VA.
 */
import { z } from "zod";
import { minimaxSize } from "@/lib/video-graphs";

export type VideoOrientationId =
  | "1_1"
  | "16_9"
  | "9_16"
  | "5_4"
  | "4_5"
  | "4_3"
  | "3_4"
  | "3_2"
  | "2_3"
  | "21_9";

export type SocialOrientationId = VideoOrientationId | "match_photo" | "match_video";

export type OrientationSize = {
  width: number;
  height: number;
  label: string;
  ratio: string;
};

/** MiniMax-friendly output sizes (long edge ≈1344, snapped to ×8). */
export const VIDEO_ORIENTATIONS: Record<VideoOrientationId, OrientationSize> = {
  "1_1": { width: 768, height: 768, label: "Square", ratio: "1:1" },
  "16_9": { width: 1344, height: 752, label: "Widescreen", ratio: "16:9" },
  "9_16": { width: 752, height: 1344, label: "Story (Vertical)", ratio: "9:16" },
  "5_4": { width: 1344, height: 1072, label: "Print (5×4)", ratio: "5:4" },
  "4_5": { width: 1072, height: 1344, label: "Feed (Portrait)", ratio: "4:5" },
  "4_3": { width: 1344, height: 1008, label: "Classic", ratio: "4:3" },
  "3_4": { width: 1008, height: 1344, label: "Vertical classic", ratio: "3:4" },
  "3_2": { width: 1344, height: 896, label: "Photo (Standard)", ratio: "3:2" },
  "2_3": { width: 896, height: 1344, label: "Portrait", ratio: "2:3" },
  "21_9": { width: 1344, height: 576, label: "Ultra wide", ratio: "21:9" },
};

export const VIDEO_ORIENTATION_IDS = Object.keys(
  VIDEO_ORIENTATIONS,
) as VideoOrientationId[];

export const videoOrientationSchema = z.enum(
  VIDEO_ORIENTATION_IDS as [VideoOrientationId, ...VideoOrientationId[]],
);

export const socialOrientationSchema = z.union([
  videoOrientationSchema,
  z.literal("match_photo"),
  z.literal("match_video"),
]);

const LEGACY_FILM: Record<string, VideoOrientationId> = {
  portrait: "3_4",
  landscape: "4_3",
  square: "1_1",
};

const LEGACY_SOCIAL: Record<string, SocialOrientationId> = {
  portrait: "9_16",
  landscape: "16_9",
  square: "1_1",
};

export function normalizeVideoOrientation(
  raw: string | null | undefined,
  fallback: VideoOrientationId = "9_16",
): VideoOrientationId {
  if (raw && raw in VIDEO_ORIENTATIONS) return raw as VideoOrientationId;
  if (raw && LEGACY_FILM[raw]) return LEGACY_FILM[raw];
  if (raw && LEGACY_SOCIAL[raw] && LEGACY_SOCIAL[raw] !== "match_photo") {
    return LEGACY_SOCIAL[raw] as VideoOrientationId;
  }
  return fallback;
}

export function normalizeSocialOrientation(
  raw: string | null | undefined,
  fallback: SocialOrientationId = "match_photo",
): SocialOrientationId {
  if (raw === "match_photo" || raw === "match_video") return raw;
  if (raw && raw in VIDEO_ORIENTATIONS) return raw as VideoOrientationId;
  if (raw && LEGACY_SOCIAL[raw]) return LEGACY_SOCIAL[raw];
  return fallback;
}

export function minimaxOutputSize(
  orientation: VideoOrientationId | SocialOrientationId,
  opts?: { photoW?: number; photoH?: number; videoW?: number; videoH?: number },
): { width: number; height: number } {
  if (orientation === "match_photo") {
    return minimaxSize(opts?.photoW || 888, opts?.photoH || 1176);
  }
  if (orientation === "match_video") {
    return minimaxSize(opts?.videoW || 1344, opts?.videoH || 768);
  }
  const o = VIDEO_ORIENTATIONS[orientation];
  return { width: o.width, height: o.height };
}

/** Krea still size — ~1.15× MiniMax bucket for sharper source frames. */
export function kreaStillSize(orientation: VideoOrientationId): OrientationSize {
  const mm = VIDEO_ORIENTATIONS[orientation];
  const scale = 1.15;
  return {
    ...mm,
    width: Math.round((mm.width * scale) / 8) * 8,
    height: Math.round((mm.height * scale) / 8) * 8,
  };
}

export function orientationOptionLabel(id: VideoOrientationId): string {
  const o = VIDEO_ORIENTATIONS[id];
  return `${o.ratio} · ${o.label}`;
}

export function socialOrientationOptionLabel(id: SocialOrientationId): string {
  if (id === "match_photo") return "Как фото (Krea)";
  if (id === "match_video") return "Как исходное видео";
  return orientationOptionLabel(id);
}
