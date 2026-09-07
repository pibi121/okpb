import { prisma } from "@/lib/db";
import { getPhotoTemplate } from "@/lib/photo-template";
import { getQuickVideoTemplateDetail } from "@/lib/quick-video-template";
import { tgAbsoluteUrl } from "@/lib/tg/media-assets";

export async function getTemplatePreviewUrl(
  userId: string,
  kind: "photo" | "video",
  templateId: string,
): Promise<string | null> {
  if (kind === "photo") {
    const row = await getPhotoTemplate(templateId);
    const raw = row?.previewImageUrl || row?.sceneImageUrl;
    return raw ? tgAbsoluteUrl(raw) : null;
  }
  const loraI2v = await prisma.loraI2vTemplate.findFirst({
    where: { id: templateId, tgPublished: true },
    select: { previewVideoUrl: true },
  });
  if (loraI2v?.previewVideoUrl?.trim()) {
    return tgAbsoluteUrl(loraI2v.previewVideoUrl.trim());
  }
  const detail = await getQuickVideoTemplateDetail(userId, templateId);
  if (!detail) return null;
  // Motion only — never send identity/ref stills as bot preview.
  const raw = detail.previewVideoUrl?.trim() || "";
  return raw ? tgAbsoluteUrl(raw) : null;
}
