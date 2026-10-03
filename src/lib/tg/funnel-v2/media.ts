/**
 * Funnel v2 bundled covers (public/tg/media/). Fallbacks keep QA unblocked.
 */
import { tgAbsoluteUrl } from "@/lib/tg/media-assets";

const COVERS = {
  hub: ["/tg/media/funnel-hub-cover.mp4", "/tg/media/onboard-2.mp4"],
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
  /** Confirm screen for «Раздеть полностью» (pose not in Lab). */
  undressPreview: [
    "/tg/media/funnel-undress-preview.mp4",
    "/tg/media/undress-example.png",
  ],
} as const;

export type FunnelCoverSlot = keyof typeof COVERS;

export type FunnelSentMessage = { message_id?: number };

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
): Promise<FunnelSentMessage | undefined> {
  // Upload local bytes (tgDeliver*) — Telegram URL fetch caches by URL and
  // keeps serving the old hub cover after we replace funnel-hub-cover.mp4.
  const { tgDeliverPhoto, tgDeliverVideo } = await import(
    "@/lib/tg/deliver-media"
  );
  const { tgSendMessage } = await import("@/lib/tg/telegram-api");
  const urls = funnelCoverFallbacks(slot);
  const extra = { reply_markup };
  for (const url of urls) {
    try {
      if (/\.(mp4|webm)(\?|$)/i.test(url)) {
        return (await tgDeliverVideo({
          chatId,
          url,
          caption,
          extra,
        })) as FunnelSentMessage;
      }
      return (await tgDeliverPhoto({
        chatId,
        url,
        caption,
        extra,
      })) as FunnelSentMessage;
    } catch {
      /* try next */
    }
  }
  return (await tgSendMessage(chatId, caption, {
    reply_markup,
  })) as FunnelSentMessage;
}
