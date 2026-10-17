import { prisma } from "@/lib/db";
import { enqueueTgOutbox } from "@/lib/tg/session";
import { mediaRelativePath } from "@/lib/tg/deliver-media";

export async function hasTelegramAccount(userId: string): Promise<{
  platformUserId: string;
  locale: "ru" | "en";
} | null> {
  const acc = await prisma.platformAccount.findFirst({
    where: { userId, platform: "telegram" },
    include: { user: true },
  });
  if (!acc) return null;
  return {
    platformUserId: acc.platformUserId,
    locale: acc.user.locale?.startsWith("en") ? "en" : "ru",
  };
}

/** True if we already queued/sent media outbox for this gallery item (dedupe recover vs primary). */
export async function alreadyQueuedTgMediaOutbox(
  userId: string,
  galleryItemId: string,
  kind: "photo" | "video",
): Promise<boolean> {
  const id = (galleryItemId || "").trim();
  if (!id) return false;
  const row = await prisma.tgOutbox.findFirst({
    where: {
      userId,
      kind,
      payloadJson: { contains: id },
    },
    select: { id: true },
  });
  return Boolean(row);
}

/**
 * Claim one TG media delivery per gallery item (meta flag + outbox check).
 * Prevents complete vs recover double-send.
 */
export async function claimTgMediaNotify(
  userId: string,
  galleryItemId: string,
  kind: "photo" | "video",
): Promise<boolean> {
  const id = (galleryItemId || "").trim();
  if (!id) return true; // no id — can't dedupe; allow
  if (await alreadyQueuedTgMediaOutbox(userId, id, kind)) return false;
  try {
    const gi = await prisma.galleryItem.findUnique({
      where: { id },
      select: { metaJson: true },
    });
    if (!gi) return true;
    const meta = JSON.parse(gi.metaJson || "{}") as Record<string, unknown>;
    if (meta.tgMediaNotified) {
      return !(await alreadyQueuedTgMediaOutbox(userId, id, kind));
    }
    const next = { ...meta, tgMediaNotified: Date.now() };
    const updated = await prisma.galleryItem.updateMany({
      where: { id, metaJson: gi.metaJson },
      data: { metaJson: JSON.stringify(next) },
    });
    return updated.count === 1;
  } catch {
    return false;
  }
}

export async function notifyTelegramMediaReady(opts: {
  userId: string;
  kind: "photo" | "video";
  mediaUrl: string;
  caption: string;
  offerSaveCharacterId?: string;
  galleryItemId?: string;
}) {
  const acc = await hasTelegramAccount(opts.userId);
  if (!acc) return;

  // Prefer relative /api/media/… so outbox can upload bytes (private gallery
  // URLs return 401 to Telegram's HTTP fetch).
  const rel = mediaRelativePath(opts.mediaUrl) || opts.mediaUrl.trim();

  let successKind: string = opts.kind;
  let funnelV2 = false;
  let offerSave = opts.offerSaveCharacterId;
  if (opts.galleryItemId) {
    if (
      !(await claimTgMediaNotify(
        opts.userId,
        opts.galleryItemId,
        opts.kind,
      ))
    ) {
      return;
    }
    try {
      const gi = await prisma.galleryItem.findUnique({
        where: { id: opts.galleryItemId },
        select: { metaJson: true },
      });
      const meta = JSON.parse(gi?.metaJson || "{}") as {
        funnelV2?: boolean;
        source?: string;
        successKind?: string;
        blurTrial?: boolean;
      };
      if (meta.funnelV2 || meta.source === "funnel_v2") {
        funnelV2 = true;
        offerSave = undefined;
        if (meta.blurTrial) successKind = "funnel_v2_blur";
        else if (meta.successKind) successKind = String(meta.successKind);
        else successKind = opts.kind === "video" ? "funnel_v2_video" : "funnel_v2_photo";
      }
    } catch {
      /* ignore */
    }
  }

  const caption =
    funnelV2 && opts.kind === "video" && !opts.caption?.includes("Готово")
      ? "❤️ Готово! Как тебе? 💦"
      : opts.caption;

  await enqueueTgOutbox({
    platformUserId: acc.platformUserId,
    userId: opts.userId,
    kind: opts.kind,
    payload: {
      url: rel,
      caption,
      successKind,
      locale: acc.locale,
      ...(opts.galleryItemId ? { galleryItemId: opts.galleryItemId } : {}),
      ...(offerSave ? { offerSaveCharacterId: offerSave } : {}),
      ...(funnelV2
        ? { funnelV2: true, attachResultKeyboard: true }
        : {}),
    },
  });
}

export async function notifyTelegramGenerationError(
  userId: string,
  message: string,
  opts?: { refunded?: number },
) {
  const acc = await hasTelegramAccount(userId);
  if (!acc) return;
  const { publicComfyErrorMessage } = await import("@/lib/comfy-client");
  const { isUserReadableCopy, userFacingTgError } = await import(
    "@/lib/tg/user-facing-error"
  );
  const ourFault =
    /ECONN|ETIMEDOUT|8188|недоступен|timeout|туннель|GPU|Comfy|Ollama|socket hang|ENOSPC|no space left|missing_node|orphan|CUDA|OutOfMemory|KSampler|traceback/i.test(
      message,
    );
  const fallback =
    acc.locale === "en"
      ? "Something went wrong. Please try again in a minute."
      : "Что-то пошло не так. Попробуй ещё раз чуть позже.";
  let text: string;
  if (ourFault) {
    const { formatNotice } = await import("@/lib/ops/notices");
    text =
      (await formatNotice("gen_fail_our_fault", acc.locale)) ||
      publicComfyErrorMessage(message, acc.locale);
  } else if (isUserReadableCopy(message)) {
    const { tFormat } = await import("@/lib/tg/i18n");
    text = tFormat("gen_error", acc.locale, {
      msg: userFacingTgError(message, fallback).slice(0, 180),
    });
  } else {
    text = userFacingTgError(message, fallback);
  }
  const refunded = Math.max(0, Math.round(Number(opts?.refunded) || 0));
  if (refunded > 0) {
    text +=
      acc.locale === "en"
        ? `\n\nReturned <b>${refunded}</b>₽ to your balance.`
        : `\n\nВернули <b>${refunded}</b>₽ на баланс.`;
  }
  await enqueueTgOutbox({
    platformUserId: acc.platformUserId,
    userId,
    kind: "error",
    payload: {
      text,
      locale: acc.locale,
    },
  });
}

/**
 * One short TG tip when video enqueue hits a long queue / warn|danger load.
 * Only the user who just queued — never broadcast, never toggles video-freeze.
 */
export async function maybeNotifyVideoQueueSlow(userId: string): Promise<boolean> {
  const acc = await hasTelegramAccount(userId);
  if (!acc) return false;
  try {
    const { collectLoadDashboard } = await import("@/lib/gpu/load-stats");
    const dash = await collectLoadDashboard({ ping: false });
    if (dash.summary.maintenance) return false;

    const videoFns = dash.functions.filter(
      (f) =>
        f.pool === "video" ||
        /video|story|animate|premium/i.test(f.key),
    );
    const videoHot = videoFns.some(
      (f) =>
        (f.health === "warn" || f.health === "danger") &&
        f.queued + f.inflight > 0,
    );
    const queued = dash.summary.jobsQueued;
    const busyVideo = dash.summary.busyVideo || 0;
    const health = dash.summary.health;
    const slow =
      health === "warn" ||
      health === "danger" ||
      videoHot ||
      queued >= 2 ||
      (queued >= 1 && busyVideo >= 1);
    if (!slow) return false;

    const ahead = Math.max(1, queued + Math.max(0, busyVideo));
    const story = videoFns.find((f) => f.key === "video_story") || videoFns[0];
    const perJobMs = Math.min(
      12 * 60_000,
      Math.max(
        4 * 60_000,
        story?.avgRunMs || story?.baselineRunMs || 8 * 60_000,
      ),
    );
    const waitMs = Math.max(story?.avgWaitMs || 0, 0);
    const etaMs = waitMs + ahead * perJobMs * 0.45;
    const minutes = Math.min(60, Math.max(5, Math.round(etaMs / 60_000)));

    const { formatNotice } = await import("@/lib/ops/notices");
    const text = await formatNotice("queue_long", acc.locale, { minutes });
    if (!text?.trim()) return false;

    await enqueueTgOutbox({
      platformUserId: acc.platformUserId,
      userId,
      kind: "text",
      payload: { text, locale: acc.locale },
    });
    return true;
  } catch (e) {
    console.warn(
      "[peach] queue_long notify skipped:",
      e instanceof Error ? e.message.slice(0, 120) : e,
    );
    return false;
  }
}

/** Notify partner when referral top-up commission is credited. */
export async function notifyPartnerCommission(opts: {
  partnerUserId: string;
  amountPeaches: number;
}) {
  if (opts.amountPeaches <= 0) return;
  const acc = await hasTelegramAccount(opts.partnerUserId);
  if (!acc) return;
  const { tFormat } = await import("@/lib/tg/i18n");
  const text = tFormat("partner_commission_notice", acc.locale, {
    n: String(opts.amountPeaches),
  });
  await enqueueTgOutbox({
    platformUserId: acc.platformUserId,
    userId: opts.partnerUserId,
    kind: "text",
    payload: { text, locale: acc.locale },
  });
}
