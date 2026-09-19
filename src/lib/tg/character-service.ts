import { prisma } from "@/lib/db";
import {
  ensureCharacterDirs,
  listCharacterPhotos,
  sanitizeTrigger,
  saveCharacterPhoto,
} from "@/lib/character-dataset";
import { emptyLookbook } from "@/lib/lookbook";

export const TG_MIN_CHARACTER_PHOTOS = 3;
export const TG_MAX_CHARACTER_PHOTOS = 5;
/** LoRA train in bot onboarding */
export const TG_MIN_LORA_PHOTOS = 5;
export const TG_MAX_LORA_PHOTOS = 20;
/** Video Ref2V — at least one identity ref */
export const TG_MIN_VIDEO_PHOTOS = 1;

export async function listTgCharacters(userId: string) {
  return prisma.character.findMany({
    where: { userId, videoRefOnly: false },
    orderBy: { createdAt: "asc" },
  });
}

export async function getPrimaryTgCharacter(userId: string) {
  return prisma.character.findFirst({
    where: { userId },
    orderBy: { createdAt: "asc" },
  });
}

export async function getActiveTgCharacter(
  userId: string,
  platformUserId: string,
) {
  const acc = await prisma.platformAccount.findUnique({
    where: {
      platform_platformUserId: {
        platform: "telegram",
        platformUserId,
      },
    },
  });
  if (acc?.activeCharacterId) {
    const ch = await prisma.character.findFirst({
      where: { id: acc.activeCharacterId },
    });
    if (ch && (ch.userId === userId || ch.isStudioCast)) return ch;
  }
  return getPrimaryTgCharacter(userId);
}

/** Owned draft for photo uploads / LoRA training — never studio cast. */
export async function getOwnedPhotoUploadCharacter(
  userId: string,
  platformUserId: string,
  preferredId?: string | null,
) {
  if (preferredId) {
    const preferred = await prisma.character.findFirst({
      where: {
        id: preferredId,
        userId,
        videoRefOnly: false,
        isStudioCast: false,
      },
    });
    if (preferred) return preferred;
  }
  const active = await getActiveTgCharacter(userId, platformUserId);
  if (
    active &&
    active.userId === userId &&
    !active.isStudioCast &&
    !active.videoRefOnly
  ) {
    return active;
  }
  const primary = await prisma.character.findFirst({
    where: { userId, videoRefOnly: false, isStudioCast: false },
    orderBy: { createdAt: "asc" },
  });
  if (primary) return primary;
  // Auto-create owned draft when user sends a photo without a character yet.
  return createTgCharacter(userId, "Model");
}

export async function setActiveTgCharacter(
  platformUserId: string,
  characterId: string,
) {
  await prisma.platformAccount.update({
    where: {
      platform_platformUserId: {
        platform: "telegram",
        platformUserId,
      },
    },
    data: { activeCharacterId: characterId },
  });
}

export async function createTgCharacter(userId: string, name?: string | null) {
  const displayName = (name ?? "").trim().slice(0, 40) || "Model";
  // Pre-create with placeholder id for trigger — set after create.
  const character = await prisma.character.create({
    data: {
      userId,
      name: displayName,
      gender: "female",
      consentGiven: true,
      photoCount: 0,
      status: "ready",
      loraStatus: "lookbook_ready",
      lookbookJson: JSON.stringify(emptyLookbook("female")),
    },
  });
  const triggerWord = sanitizeTrigger(displayName, character.id);
  const updated = await prisma.character.update({
    where: { id: character.id },
    data: { triggerWord },
  });
  ensureCharacterDirs(character.id);
  return updated;
}

/** Ref2V video identity — saved refs with 🎬, no LoRA training. */
export async function createVideoRefCharacter(
  userId: string,
  name?: string | null,
) {
  const displayName = (name ?? "").trim().slice(0, 40) || "Модель";
  const character = await prisma.character.create({
    data: {
      userId,
      name: displayName,
      gender: "female",
      consentGiven: true,
      photoCount: 0,
      status: "ready",
      loraStatus: "lookbook_ready",
      videoRefOnly: true,
      lookbookJson: JSON.stringify(emptyLookbook("female")),
    },
  });
  const triggerWord = sanitizeTrigger(displayName, character.id);
  const updated = await prisma.character.update({
    where: { id: character.id },
    data: { triggerWord },
  });
  ensureCharacterDirs(character.id);
  return updated;
}

export async function listVideoRefCharacters(userId: string) {
  return prisma.character.findMany({
    where: { userId, videoRefOnly: true },
    orderBy: { createdAt: "desc" },
  });
}

export async function renameTgCharacter(
  userId: string,
  characterId: string,
  name?: string | null,
) {
  return prisma.character.updateMany({
    where: { id: characterId, userId },
    data: { name: (name ?? "").trim().slice(0, 40) || "Model" },
  });
}

export async function ensureTgCharacter(userId: string, name?: string) {
  const existing = await getPrimaryTgCharacter(userId);
  if (existing) return existing;
  return createTgCharacter(userId, name || "Model");
}

export async function addCharacterPhotoFromBuffer(
  userId: string,
  characterId: string,
  buf: Buffer,
  fileName: string,
  opts?: { maxPhotos?: number; locale?: "ru" | "en"; skipAgeGate?: boolean },
) {
  const ch = await prisma.character.findFirst({
    where: {
      id: characterId,
      userId,
      isStudioCast: false,
      videoRefOnly: false,
    },
  });
  if (!ch) throw new Error("character not found");

  const maxPhotos = opts?.maxPhotos ?? TG_MAX_CHARACTER_PHOTOS;
  const existing = listCharacterPhotos(characterId);
  if (existing.length >= maxPhotos) {
    throw new Error("max photos");
  }

  if (!opts?.skipAgeGate) {
    const { assertImageAllowedForGeneration } = await import("@/lib/age-gate");
    await assertImageAllowedForGeneration(buf, opts?.locale || "ru");
  }

  saveCharacterPhoto(characterId, fileName, buf, ch.triggerWord);
  const photos = listCharacterPhotos(characterId);
  await prisma.character.update({
    where: { id: characterId },
    data: { photoCount: photos.length },
  });
  return photos;
}

export function characterPhotoCount(characterId: string): number {
  return listCharacterPhotos(characterId).length;
}

export function characterReady(characterId: string): boolean {
  return characterPhotoCount(characterId) >= TG_MIN_CHARACTER_PHOTOS;
}

export function characterReadyForVideo(characterId: string): boolean {
  return characterPhotoCount(characterId) >= TG_MIN_VIDEO_PHOTOS;
}

export function characterReadyForLoraTrain(characterId: string): boolean {
  return characterPhotoCount(characterId) >= TG_MIN_LORA_PHOTOS;
}
