import { prisma } from "@/lib/db";
import {
  ensureCharacterDirs,
  listCharacterPhotos,
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

export async function createTgCharacter(userId: string, name: string) {
  const character = await prisma.character.create({
    data: {
      userId,
      name: name.trim().slice(0, 40) || "Model",
      gender: "female",
      consentGiven: true,
      photoCount: 0,
      status: "ready",
      loraStatus: "lookbook_ready",
      lookbookJson: JSON.stringify(emptyLookbook("female")),
    },
  });
  ensureCharacterDirs(character.id);
  return character;
}

/** Ref2V video identity — saved refs with 🎬, no LoRA training. */
export async function createVideoRefCharacter(userId: string, name: string) {
  const character = await prisma.character.create({
    data: {
      userId,
      name: name.trim().slice(0, 40) || "Модель",
      gender: "female",
      consentGiven: true,
      photoCount: 0,
      status: "ready",
      loraStatus: "lookbook_ready",
      videoRefOnly: true,
      lookbookJson: JSON.stringify(emptyLookbook("female")),
    },
  });
  ensureCharacterDirs(character.id);
  return character;
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
  name: string,
) {
  return prisma.character.updateMany({
    where: { id: characterId, userId },
    data: { name: name.trim().slice(0, 40) || "Model" },
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
  opts?: { maxPhotos?: number },
) {
  const ch = await prisma.character.findFirst({
    where: { id: characterId, userId },
  });
  if (!ch) throw new Error("character not found");

  const maxPhotos = opts?.maxPhotos ?? TG_MAX_CHARACTER_PHOTOS;
  const existing = listCharacterPhotos(characterId);
  if (existing.length >= maxPhotos) {
    throw new Error("max photos");
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
