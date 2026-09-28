/**
 * Single funnel-v2 result delivery: drop «творю» UI, claim once, one outbox row
 * with keyboard on the media (no second «Готово» spam).
 */
import { enqueueTgOutbox } from "@/lib/tg/session";
import type { TgLocale } from "@/lib/tg/i18n";
import { funnelV2DropUi } from "@/lib/tg/funnel-v2/ui";
import { claimTgMediaNotify } from "@/lib/tg/tg-notify";

export async function enqueueFunnelV2Result(opts: {
  userId: string;
  platformUserId: string;
  locale: TgLocale;
  kind: "photo" | "video";
  url: string;
  galleryItemId: string;
  successKind: "funnel_v2_photo" | "funnel_v2_video" | "funnel_v2_blur";
  blurTrial?: boolean;
  /** Attach «Не понравилось» (paid undress / photo template only). */
  offerQcDislike?: boolean;
  caption?: string;
  extraPayload?: Record<string, unknown>;
}): Promise<boolean> {
  if (
    !(await claimTgMediaNotify(opts.userId, opts.galleryItemId, opts.kind))
  ) {
    return false;
  }
  const chatId = Number(opts.platformUserId);
  if (Number.isFinite(chatId)) {
    await funnelV2DropUi(opts.platformUserId, chatId).catch(() => undefined);
  }
  const caption =
    opts.caption?.trim() ||
    (opts.kind === "video" || opts.successKind === "funnel_v2_video"
      ? "❤️ Готово! Как тебе? 💦"
      : "");
  await enqueueTgOutbox({
    userId: opts.userId,
    platformUserId: opts.platformUserId,
    kind: opts.kind,
    payload: {
      url: opts.url,
      caption,
      successKind: opts.successKind,
      galleryItemId: opts.galleryItemId,
      locale: opts.locale,
      funnelV2: true,
      attachResultKeyboard: true,
      ...(opts.blurTrial ? { blurTrial: true } : {}),
      ...(opts.offerQcDislike ? { offerQcDislike: true } : {}),
      ...(opts.extraPayload || {}),
    },
  });
  return true;
}
