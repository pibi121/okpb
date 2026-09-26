/**
 * Funnel v2 bundled covers (public/tg/media/). Fallbacks keep QA unblocked.
 */
import { tgAbsoluteUrl } from "@/lib/tg/media-assets";

const COVERS = {
  hub: ["/tg/media/funnel-hub-cover.png", "/tg/media/onboard-2.mp4"],
  photoPlaceholder: [
    "/tg/media/funnel-photo-placeholder.png",
    "/tg/media/undress-example.png",
  ],
  needTopup: [
    "/tg/media/funnel-need-topup.png",
    "/tg/media/undress-disclaimer.png",
  ],
  animate: [
    "/tg/media/funnel-animate-cover.png",
    "/tg/media/undress-example.png",
  ],
  editDemo: ["/tg/media/funnel-edit-demo.mp4", "/tg/media/onboard-3.jpg"],
  topup: ["/tg/media/funnel-topup-cover.png", "/tg/media/topup.jpg"],
  videoPlaceholder: [
    "/tg/media/funnel-photo-placeholder.png",
    "/tg/media/undress-example.png",
  ],
} as const;

export type FunnelCoverSlot = keyof typeof COVERS;

export function funnelCoverUrl(slot: FunnelCoverSlot): string {
  const primary = COVERS[slot][0]!;
  return tgAbsoluteUrl(primary);
}

/** Prefer primary path; callers may try/catch and use fallback. */
export function funnelCoverFallbacks(slot: FunnelCoverSlot): string[] {
  return COVERS[slot].map((p) => tgAbsoluteUrl(p));
}

export async function sendCoverPhoto(
  chatId: number,
  slot: FunnelCoverSlot,
  caption: string,
  reply_markup: Record<string, unknown>,
) {
  const { tgSendPhoto, tgSendMessage, tgSendVideo } = await import(
    "@/lib/tg/telegram-api"
  );
  const urls = funnelCoverFallbacks(slot);
  for (const url of urls) {
    try {
      if (/\.(mp4|webm)(\?|$)/i.test(url)) {
        await tgSendVideo(chatId, url, caption, { reply_markup });
        return;
      }
      await tgSendPhoto(chatId, url, caption, { reply_markup });
      return;
    } catch {
      /* try next */
    }
  }
  await tgSendMessage(chatId, caption, { reply_markup });
}
