/** Wait for gallery item ready and enqueue TG outbox for funnel v2. */
import { prisma } from "@/lib/db";
import { galleryStatus } from "@/lib/gallery-meta";
import { enqueueTgOutbox } from "@/lib/tg/session";
import type { TgLocale } from "@/lib/tg/i18n";

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
      await enqueueTgOutbox({
        userId: opts.userId,
        platformUserId: opts.platformUserId,
        kind: opts.kind,
        payload: {
          url: gi.resultUrl,
          caption: "",
          successKind: opts.successKind,
          galleryItemId: gi.id,
          locale: opts.locale,
          funnelV2: true,
        },
      });
      return;
    }
  })();
}
