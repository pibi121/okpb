import { prisma } from "@/lib/db";
import { backupDatabase, saveGalleryBinary } from "@/lib/local-store";

export type PublicSocialTemplate = {
  id: string;
  title: string;
  notes: string;
  kreaPhotoPrompt: string;
  scenePrompt: string;
  motionPrompt: string;
  sam3Target: string;
  durationSec: number;
  previewVideoUrl: string;
  previewPhotoUrl: string;
  published: boolean;
  status: string;
  hasDrivingVideo: boolean;
  createdAt: string;
  updatedAt: string;
};

function toPublic(row: {
  id: string;
  title: string;
  notes: string;
  kreaPhotoPrompt: string;
  scenePrompt: string;
  motionPrompt: string;
  sam3Target: string;
  durationSec: number;
  previewVideoUrl: string;
  previewPhotoUrl: string;
  published: boolean;
  status: string;
  drivingVideoUrl: string;
  createdAt: Date;
  updatedAt: Date;
}): PublicSocialTemplate {
  return {
    id: row.id,
    title: row.title,
    notes: row.notes,
    kreaPhotoPrompt: row.kreaPhotoPrompt,
    scenePrompt: row.scenePrompt,
    motionPrompt: row.motionPrompt,
    sam3Target: row.sam3Target,
    durationSec: row.durationSec,
    previewVideoUrl: row.previewVideoUrl,
    previewPhotoUrl: row.previewPhotoUrl,
    published: row.published,
    status: row.status,
    hasDrivingVideo: !!row.drivingVideoUrl,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listSocialTemplates(
  userId: string,
  opts?: { publishedOnly?: boolean },
) {
  const rows = await prisma.socialTemplate.findMany({
    where: opts?.publishedOnly
      ? { OR: [{ published: true }, { userId }] }
      : { userId },
    orderBy: { updatedAt: "desc" },
    take: 50,
  });
  return rows.map(toPublic);
}

export async function getSocialTemplate(userId: string, id: string) {
  const row = await prisma.socialTemplate.findFirst({
    where: { id, OR: [{ userId }, { published: true }] },
  });
  return row ? toPublic(row) : null;
}

export async function getSocialTemplateInternal(userId: string, id: string) {
  return prisma.socialTemplate.findFirst({
    where: { id, OR: [{ userId }, { published: true }] },
  });
}

export async function createSocialTemplate(
  userId: string,
  opts: {
    title: string;
    notes?: string;
    kreaPhotoPrompt: string;
    scenePrompt?: string;
    motionPrompt?: string;
    sam3Target?: string;
    durationSec?: number;
  },
) {
  const row = await prisma.socialTemplate.create({
    data: {
      userId,
      title: opts.title.trim() || "Social template",
      notes: opts.notes?.trim() || "",
      kreaPhotoPrompt: opts.kreaPhotoPrompt.trim(),
      scenePrompt: opts.scenePrompt?.trim() || "",
      motionPrompt: opts.motionPrompt?.trim() || "",
      sam3Target: opts.sam3Target?.trim() || "The woman",
      durationSec: opts.durationSec ?? 10,
      status: "draft",
      published: false,
    },
  });
  backupDatabase("social-template");
  return toPublic(row);
}

export async function updateSocialTemplate(
  userId: string,
  id: string,
  patch: Partial<{
    title: string;
    notes: string;
    kreaPhotoPrompt: string;
    scenePrompt: string;
    motionPrompt: string;
    sam3Target: string;
    durationSec: number;
    drivingVideoUrl: string;
    previewVideoUrl: string;
    previewPhotoUrl: string;
    published: boolean;
    status: string;
  }>,
) {
  const existing = await prisma.socialTemplate.findFirst({
    where: { id, userId },
  });
  if (!existing) throw new Error("template not found");
  const row = await prisma.socialTemplate.update({
    where: { id },
    data: patch,
  });
  backupDatabase("social-template");
  return toPublic(row);
}

export async function deleteSocialTemplate(userId: string, id: string) {
  const existing = await prisma.socialTemplate.findFirst({
    where: { id, userId },
  });
  if (!existing) throw new Error("template not found");
  await prisma.socialTemplate.delete({ where: { id } });
  backupDatabase("social-template");
}

export async function publishSocialTemplate(userId: string, id: string) {
  const tpl = await prisma.socialTemplate.findFirst({ where: { id, userId } });
  if (!tpl) throw new Error("template not found");
  if (!tpl.drivingVideoUrl) throw new Error("Сначала загрузи driving video");
  if (!tpl.kreaPhotoPrompt.trim()) throw new Error("Нужен Krea photo prompt");
  return updateSocialTemplate(userId, id, {
    published: true,
    status: "ready",
  });
}

export function saveTemplateMedia(
  userId: string,
  ext: string,
  bytes: Buffer,
  prefix: string,
) {
  return saveGalleryBinary(userId, ext, bytes, prefix);
}
