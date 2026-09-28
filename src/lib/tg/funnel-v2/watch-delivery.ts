/** Wait for gallery item ready and enqueue TG outbox for funnel v2. */
import { prisma } from "@/lib/db";
import { galleryStatus } from "@/lib/gallery-meta";
import type { TgLocale } from "@/lib/tg/i18n";
import { enqueueFunnelV2Result } from "@/lib/tg/funnel-v2/enqueue-result";

export function watchFunnelV2Delivery(opts: {
  galleryItemId: string;
  userId: string;
  platformUserId: string;
  locale: TgLocale;
  kind: "photo" | "video";
  successKind: "funnel_v2_photo" | "funnel_v2_video" | "funnel_v2_blur";
}) {
  void (async () => {
    for (let i = 0; i < 180; i++) {
      await new Promise((r) => setTimeout(r, 4000));
      const gi = await prisma.galleryItem.findUnique({
        where: { id: opts.galleryItemId },
      });
      if (!gi) return;
      const st = galleryStatus(gi.metaJson);
      if (st === "error") return;
      if (st !== "ready" || !gi.resultUrl?.trim()) continue;
      await enqueueFunnelV2Result({
        userId: opts.userId,
        platformUserId: opts.platformUserId,
        locale: opts.locale,
        kind: opts.kind,
        url: gi.resultUrl,
        galleryItemId: gi.id,
        successKind: opts.successKind,
      });
      return;
    }
  })();
}
