import { prisma } from "@/lib/db";
import {
  clampFunnelPageSize,
  parseFunnelKeyboardSettings,
  type FunnelKeyboardSettings,
} from "@/lib/tg/funnel-v2/keyboard-layout";

export async function loadFunnelKeyboardSettings(): Promise<FunnelKeyboardSettings> {
  const row = await prisma.opsSetting.findUnique({
    where: { id: "main" },
    select: { funnelV2KeyboardJson: true },
  });
  return parseFunnelKeyboardSettings(row?.funnelV2KeyboardJson);
}

export async function saveFunnelKeyboardSettings(
  patch: Partial<FunnelKeyboardSettings>,
): Promise<FunnelKeyboardSettings> {
  const current = await loadFunnelKeyboardSettings();
  const next: FunnelKeyboardSettings = {
    photo: patch.photo
      ? {
          customRows: patch.photo.customRows === true,
          firstPageSize: clampFunnelPageSize(patch.photo.firstPageSize),
          nextPageSize: clampFunnelPageSize(patch.photo.nextPageSize),
        }
      : current.photo,
    video: patch.video
      ? {
          customRows: patch.video.customRows === true,
          firstPageSize: clampFunnelPageSize(patch.video.firstPageSize),
          nextPageSize: clampFunnelPageSize(patch.video.nextPageSize),
        }
      : current.video,
  };
  await prisma.opsSetting.upsert({
    where: { id: "main" },
    create: { id: "main", funnelV2KeyboardJson: JSON.stringify(next) },
    update: { funnelV2KeyboardJson: JSON.stringify(next) },
  });
  return next;
}
