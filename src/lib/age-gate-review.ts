/**
 * OPS Safety photo review queue for age-gate uncertain results.
 */
import { prisma } from "@/lib/db";
import { saveGalleryBinary } from "@/lib/local-store";
import {
  ageGateApprovedMessage,
  ageGateBlockMessage,
  ageGatePhotoHash,
  ageGateUncertainMessage,
  type AgeGateResult,
} from "@/lib/age-gate";
import { tgNotifyUser } from "@/lib/tg/notify-user";
import { tgSendMessage } from "@/lib/tg/telegram-api";
import {
  ageGateAppealAllowed,
  ageGateAppealButtonText,
} from "@/lib/age-gate";

/** Callback prefix for the «Ей есть 18!» button: `ag18:<reviewId>`. */
export const AGE_GATE_APPEAL_CB = "ag18:";

const APPEAL_SENT_RU = "Отправили фото на проверку — сообщим, когда проверим.";
const APPEAL_SENT_EN = "Sent for review — we'll let you know once we've checked it.";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Account for a hard age-gate block: funnel event (analytics) and, when a human
 * can overrule it, store the photo as status="blocked" so the user can appeal.
 * Never throws.
 */
export async function recordAgeGateBlock(opts: {
  userId: string;
  platformUserId: string;
  chatId?: string | number;
  locale: "ru" | "en";
  result: AgeGateResult;
  photoBytes?: Buffer;
  surface: "bot" | "miniapp";
}): Promise<{ reviewId: string | null }> {
  let reviewId: string | null = null;
  try {
    const reason = opts.result.reason || "";
    const hash =
      opts.result.photoHash ||
      (opts.photoBytes ? ageGatePhotoHash(opts.photoBytes) : "");
    const appeal = ageGateAppealAllowed(opts.result);

    // Checker outages are not photo blocks — keep them out of the metric.
    if (reason !== "checker_unavailable" && reason !== "checker_error") {
      const { trackFunnelEvent } = await import("@/lib/ops/funnel-track");
      await trackFunnelEvent({
        userId: opts.userId,
        platformUserId: opts.platformUserId,
        eventKey: "bot.agegate.block",
        surface: opts.surface,
        meta: { reason, hash, appeal },
      });
    }

    if (appeal && opts.photoBytes?.length && hash && opts.surface === "bot") {
      const existing = await prisma.ageGateReview.findFirst({
        where: { userId: opts.userId, photoHash: hash },
        orderBy: { createdAt: "desc" },
      });
      if (existing) {
        // Already rejected by a human → no second appeal for the same file.
        reviewId = existing.status === "rejected" ? null : existing.id;
      } else if (
        (await prisma.ageGateReview.count({
          where: {
            userId: opts.userId,
            createdAt: { gte: new Date(Date.now() - 24 * 3600_000) },
          },
        })) >= 10
      ) {
        // Anti-abuse: at most 10 stored/appealable photos per user per day.
        reviewId = null;
      } else {
        const saved = saveGalleryBinary(
          opts.userId,
          "jpg",
          opts.photoBytes,
          "age_review",
        );
        const row = await prisma.ageGateReview.create({
          data: {
            userId: opts.userId,
            platformUserId: opts.platformUserId,
            chatId: String(opts.chatId ?? opts.platformUserId),
            locale: opts.locale,
            photoRelKey: saved.relKey,
            photoUrl: saved.publicUrl,
            photoHash: hash,
            status: "blocked",
            gateJson: JSON.stringify(opts.result),
          },
        });
        reviewId = row.id;
      }
    }
  } catch (e) {
    console.error("[age-gate] recordAgeGateBlock:", e);
  }
  return { reviewId };
}

/**
 * Bot reply for a hard block: same text as before, plus «Ей есть 18!» when the
 * block can be appealed. Drop-in for `tgSendMessage(chatId, e.message)`.
 */
export async function replyAgeGateBlocked(opts: {
  chatId: number;
  userId: string;
  platformUserId: string;
  locale: "ru" | "en";
  error: { message: string; result: AgeGateResult; buf?: Buffer };
  photoBytes?: Buffer;
  /** Used instead of the appeal button when the block can't be appealed. */
  fallbackExtra?: Record<string, unknown>;
}): Promise<void> {
  const { reviewId } = await recordAgeGateBlock({
    userId: opts.userId,
    platformUserId: opts.platformUserId,
    chatId: opts.chatId,
    locale: opts.locale,
    result: opts.error.result,
    photoBytes: opts.photoBytes || opts.error.buf,
    surface: "bot",
  });
  await tgSendMessage(
    opts.chatId,
    opts.error.message,
    reviewId
      ? {
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: ageGateAppealButtonText(opts.locale),
                  callback_data: `${AGE_GATE_APPEAL_CB}${reviewId}`,
                },
              ],
            ],
          },
        }
      : opts.fallbackExtra,
  );
}

/** «Ей есть 18!» pressed: blocked → pending, ping OPS chat. Returns text for the user. */
export async function submitAgeGateAppeal(opts: {
  reviewId: string;
  userId: string;
  locale: "ru" | "en";
}): Promise<{ text: string; queued: boolean }> {
  const sent = opts.locale === "en" ? APPEAL_SENT_EN : APPEAL_SENT_RU;
  const row = await prisma.ageGateReview.findUnique({
    where: { id: opts.reviewId },
  });
  if (!row || row.userId !== opts.userId) {
    return { text: ageGateBlockMessage(opts.locale, "probable_minor"), queued: false };
  }
  if (row.status === "approved") {
    return { text: ageGateApprovedMessage(opts.locale), queued: false };
  }
  if (row.status === "rejected") {
    return {
      text: ageGateBlockMessage(opts.locale, "probable_minor"),
      queued: false,
    };
  }
  if (row.status === "pending") return { text: sent, queued: false };

  const upd = await prisma.ageGateReview.updateMany({
    where: { id: row.id, status: "blocked" },
    data: { status: "pending" },
  });
  if (upd.count === 0) return { text: sent, queued: false };

  const { trackFunnelEventBg } = await import("@/lib/ops/funnel-track");
  trackFunnelEventBg({
    userId: row.userId,
    platformUserId: row.platformUserId,
    eventKey: "bot.agegate.appeal",
    surface: "bot",
    meta: { reviewId: row.id, hash: row.photoHash },
  });

  void notifyOpsAgeGateAppeal(row.id).catch((e) =>
    console.error("[age-gate] ops notify:", e),
  );
  return { text: sent, queued: true };
}

async function notifyOpsAgeGateAppeal(reviewId: string): Promise<void> {
  const { opsTelegramConfigured, sendOpsTelegram } = await import(
    "@/lib/ops/ops-telegram"
  );
  if (!opsTelegramConfigured()) return;
  const row = await prisma.ageGateReview.findUnique({
    where: { id: reviewId },
  });
  if (!row) return;
  let gate: { reason?: string; ageLabel?: string; ageYears?: number; score?: number } = {};
  try {
    gate = JSON.parse(row.gateJson || "{}");
  } catch {
    gate = {};
  }
  const acc = await prisma.platformAccount.findFirst({
    where: { userId: row.userId, platform: "telegram" },
    orderBy: { lastSeenAt: "desc" },
    select: { username: true, platformUserId: true },
  });
  const who = acc?.username
    ? `@${esc(acc.username)} (${esc(acc.platformUserId)})`
    : `<code>${esc(row.userId)}</code>`;
  const age =
    gate.ageYears != null
      ? `~${Math.round(gate.ageYears)} лет`
      : gate.ageLabel || "—";
  const text = [
    `🔞 <b>Фото на ручную проверку</b> («Ей есть 18!»)`,
    `Кто: ${who}`,
    `Оценка: ${esc(String(age))}${gate.score != null ? ` · score ${gate.score}` : ""}`,
    `Причина: ${esc(gate.reason || "—")}`,
    `Очередь: OPS → Безопасность`,
  ].join("\n");
  await sendOpsTelegram("quality", text);
}

export async function submitAgeGateUncertainReview(opts: {
  userId: string;
  platformUserId: string;
  chatId: string | number;
  locale: "ru" | "en";
  photoBytes: Buffer;
  result: AgeGateResult;
  /** Notify user with "under review" (default true) */
  notifyUser?: boolean;
}): Promise<{ reviewId: string; duplicate: boolean; photoUrl: string }> {
  const hash = opts.result.photoHash || ageGatePhotoHash(opts.photoBytes);
  const existing = await prisma.ageGateReview.findFirst({
    where: {
      photoHash: hash,
      userId: opts.userId,
      status: "pending",
    },
    orderBy: { createdAt: "desc" },
  });
  if (existing) {
    if (opts.notifyUser !== false) {
      await tgNotifyUser({
        userId: opts.userId,
        text: ageGateUncertainMessage(opts.locale),
      }).catch(() => undefined);
    }
    return {
      reviewId: existing.id,
      duplicate: true,
      photoUrl: existing.photoUrl,
    };
  }

  const saved = saveGalleryBinary(
    opts.userId,
    "jpg",
    opts.photoBytes,
    "age_review",
  );

  const row = await prisma.ageGateReview.create({
    data: {
      userId: opts.userId,
      platformUserId: opts.platformUserId,
      chatId: String(opts.chatId),
      locale: opts.locale,
      photoRelKey: saved.relKey,
      photoUrl: saved.publicUrl,
      photoHash: hash,
      status: "pending",
      gateJson: JSON.stringify(opts.result),
    },
  });

  if (opts.notifyUser !== false) {
    await tgNotifyUser({
      userId: opts.userId,
      text: ageGateUncertainMessage(opts.locale),
    }).catch(() => undefined);
  }

  return {
    reviewId: row.id,
    duplicate: false,
    photoUrl: saved.publicUrl,
  };
}

export async function resolveAgeGateReview(opts: {
  id: string;
  decision: "approved" | "rejected";
  opsUserId: string;
}): Promise<{ ok: true; status: string; userId: string }> {
  const row = await prisma.ageGateReview.findUnique({ where: { id: opts.id } });
  if (!row) throw new Error("review not found");
  if (row.status !== "pending") {
    return { ok: true, status: row.status, userId: row.userId };
  }

  await prisma.ageGateReview.update({
    where: { id: row.id },
    data: {
      status: opts.decision,
      reviewedAt: new Date(),
      reviewedByOpsUserId: opts.opsUserId,
    },
  });

  const locale = row.locale === "en" ? "en" : "ru";
  const text =
    opts.decision === "approved"
      ? ageGateApprovedMessage(locale)
      : ageGateBlockMessage(locale, "probable_minor");

  await tgNotifyUser({ userId: row.userId, text }).catch(() => undefined);

  return { ok: true, status: opts.decision, userId: row.userId };
}
