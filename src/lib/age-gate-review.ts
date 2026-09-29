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
