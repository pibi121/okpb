/** Static preview URLs for TG catalog (no gallery media on prod yet). */

export const STUDIO_CAST_COVER: Record<string, string> = {
  daisysh: "/tg/previews/cast-daisy.svg",
  masha1: "/tg/previews/cast-masha.svg",
  olh_person: "/tg/previews/cast-lora.svg",
};

export const VIDEO_TEMPLATE_PREVIEWS = [
  "/tg/media/onboard-1.mp4",
  "/tg/media/onboard-2.mp4",
] as const;

export const PHOTO_TEMPLATE_PREVIEW = "/tg/previews/template-photo.svg";

export function studioCastCoverUrl(triggerWord?: string | null): string | null {
  if (!triggerWord) return null;
  return STUDIO_CAST_COVER[triggerWord] || null;
}

export function videoTemplatePreviewByIndex(index: number): string {
  return VIDEO_TEMPLATE_PREVIEWS[index] ?? VIDEO_TEMPLATE_PREVIEWS[0]!;
}

export function photoTemplatePreview(): string {
  return PHOTO_TEMPLATE_PREVIEW;
}
