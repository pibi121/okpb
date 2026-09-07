/**
 * Client-safe photo ref constants and parsers (no server / DB imports).
 */
import type { QuickVideoImageSlot, QuickVideoSlotRole } from "@/lib/quick-video-prompt";

/** Krea Identity Edit uses one person image. */
export const PHOTO_FACE_REF_COUNT = 1;

export type PhotoManualSlot = {
  pictureIndex: number;
  role: QuickVideoSlotRole;
  label?: string;
  characterName?: string;
  bytes: Buffer;
  ext?: string;
};

export function parseRefSlotsJson(raw: string): QuickVideoImageSlot[] {
  try {
    const j = JSON.parse(raw || "[]");
    return Array.isArray(j) ? (j as QuickVideoImageSlot[]) : [];
  } catch {
    return [];
  }
}

export function parseRefUrlsJson(raw: string): string[] {
  try {
    const j = JSON.parse(raw || "[]");
    return Array.isArray(j)
      ? j.filter((u): u is string => typeof u === "string")
      : [];
  } catch {
    return [];
  }
}
