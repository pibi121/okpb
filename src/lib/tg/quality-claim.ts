import { prisma } from "@/lib/db";
import { parseGalleryMeta } from "@/lib/gallery-meta";
import { creditPeaches } from "@/lib/tg/wallet";
import type { TgLocale } from "@/lib/tg/i18n";
import { t, tFormat } from "@/lib/tg/i18n";
import {
  tgAnswerCallbackQuery,
  tgEditMessageReplyMarkup,
  tgSendMessage,
} from "@/lib/tg/telegram-api";
import { successInlineKeyboard, QC_CB } from "@/lib/tg/generation-flow";

export type QualityClaimStatus = "pending" | "approved" | "rejected";

export function qcStatusKeyboard(
  locale: TgLocale,
  kind: "photo" | "video",
  status: QualityClaimStatus | "idle",
  galleryItemId: string,
) {
  return successInlineKeyboard(locale, {
    kind,
    galleryItemId,
    qcStatus: status,
  });
}

export async function chargedPeachesForGalleryItem(
  galleryItemId: string,
): Promise<number> {
  const item = await prisma.galleryItem.findUnique({
    where: { id: galleryItemId },
    select: { metaJson: true },
  });
  if (!item) return 0;
  const meta = parseGalleryMeta(item.metaJson);
  const n = Number(meta.chargedPeaches);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

export async function patchGalleryChargedPeaches(
  galleryItemId: string,
  chargedPeaches: number,
) {
  if (!(chargedPeaches > 0) || !galleryItemId) return;
  const item = await prisma.galleryItem.findUnique({
    where: { id: galleryItemId },
    select: { metaJson: true },
  });
  if (!item) return;
  const meta = parseGalleryMeta(item.metaJson);
  if (Number(meta.chargedPeaches) > 0) return;
  await prisma.galleryItem.update({
    where: { id: galleryItemId },
    data: {
      metaJson: JSON.stringify({ ...meta, chargedPeaches }),
    },
  });
}

/** User pressed «Не понравилось» — ask for confirm. */
export async function handleQcDislike(opts: {
  callbackId: string;
  chatId: number;
  messageId: number;
  userId: string;
  platformUserId: string;
  locale: TgLocale;
  galleryItemId: string;
}) {
  const item = await prisma.galleryItem.findFirst({
    where: { id: opts.galleryItemId, userId: opts.userId },
  });
  if (!item || (item.kind !== "photo" && item.kind !== "video")) {
    await tgAnswerCallbackQuery(
      opts.callbackId,
      opts.locale === "en" ? "Work not found" : "Работа не найдена",
    );
    return;
  }

  const existing = await prisma.qualityClaim.findUnique({
    where: { galleryItemId: item.id },
  });
  if (existing) {
    await tgAnswerCallbackQuery(
      opts.callbackId,
      opts.locale === "en"
        ? "Already submitted"
        : "Заявка уже отправлена",
    );
    return;
  }

  const { setTgSession } = await import("@/lib/tg/session");
  await setTgSession(opts.platformUserId, {
    pending: {
      qcItemId: item.id,
      qcSuccessMessageId: opts.messageId,
    },
  });

  await tgAnswerCallbackQuery(opts.callbackId);
  await tgSendMessage(opts.chatId, t("qc_confirm_prompt", opts.locale), {
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: t("qc_confirm_btn", opts.locale),
            callback_data: QC_CB.confirm(item.id),
          },
        ],
      ],
    },
  });
}

/** User confirmed — create claim + ops notify. */
export async function handleQcConfirm(opts: {
  callbackId: string;
  chatId: number;
  userId: string;
  platformUserId: string;
  locale: TgLocale;
  galleryItemId: string;
}) {
  const item = await prisma.galleryItem.findFirst({
    where: { id: opts.galleryItemId, userId: opts.userId },
  });
  if (!item || (item.kind !== "photo" && item.kind !== "video")) {
    await tgAnswerCallbackQuery(
      opts.callbackId,
      opts.locale === "en" ? "Work not found" : "Работа не найдена",
    );
    return;
  }

  const existing = await prisma.qualityClaim.findUnique({
    where: { galleryItemId: item.id },
  });
  if (existing) {
    await tgAnswerCallbackQuery(
      opts.callbackId,
      opts.locale === "en" ? "Already on review" : "Уже на проверке",
    );
    return;
  }

  const { getTgSession, parsePending, setTgSession } = await import(
    "@/lib/tg/session"
  );
  const session = await getTgSession(opts.platformUserId);
  const pending = parsePending(session?.pendingJson || "{}");
  const successMessageId =
    pending.qcItemId === item.id ? pending.qcSuccessMessageId : undefined;

  const charged = await chargedPeachesForGalleryItem(item.id);
  const kind = item.kind as "photo" | "video";

  const claim = await prisma.qualityClaim.create({
    data: {
      userId: opts.userId,
      galleryItemId: item.id,
      kind,
      status: "pending",
      chargedPeaches: charged,
      tgChatId: String(opts.chatId),
      tgMessageId: successMessageId ?? null,
    },
  });

  await setTgSession(opts.platformUserId, {
    pending: { qcItemId: undefined, qcSuccessMessageId: undefined },
  });

  if (successMessageId) {
    await tgEditMessageReplyMarkup(
      opts.chatId,
      successMessageId,
      qcStatusKeyboard(opts.locale, kind, "pending", item.id),
    ).catch(() => undefined);
  }

  await tgAnswerCallbackQuery(opts.callbackId);
  await tgSendMessage(opts.chatId, t("qc_submitted", opts.locale));

  void notifyOpsQualityClaim(claim.id).catch((e) =>
    console.error("[qc] ops notify:", e),
  );
}

export async function notifyOpsQualityClaim(claimId: string) {
  const claim = await prisma.qualityClaim.findUnique({
    where: { id: claimId },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          balancePeaches: true,
          platformAccounts: {
            where: { platform: "telegram" },
            select: { platformUserId: true, username: true },
            take: 1,
          },
        },
      },
      galleryItem: { select: { id: true, title: true, resultUrl: true } },
    },
  });
  if (!claim) return;

  const tg = claim.user.platformAccounts[0];
  const who = claim.user.name || claim.user.email || claim.user.id;
  const uname = tg?.username ? `@${tg.username}` : tg?.platformUserId || "—";
  const totalClaims = await prisma.qualityClaim.count({
    where: { userId: claim.userId },
  });
  const {
    sendOpsTelegramGetMessageId,
    escHtml,
    formatMsk,
  } = await import("@/lib/ops/ops-telegram");

  const text = [
    `<b>Контроль качества</b> · <b>Не рассмотрено</b>`,
    ``,
    `Тип: <b>${claim.kind === "video" ? "видео" : "фото"}</b>`,
    `Пользователь: ${escHtml(who)} (${escHtml(uname)})`,
    `Id: <code>${escHtml(claim.userId)}</code>`,
    `Работа: <code>${escHtml(claim.galleryItemId)}</code>`,
    `Списано: <b>${claim.chargedPeaches}</b> 🍑`,
    `Заявок всего: <b>${totalClaims}</b>`,
    `Время: ${formatMsk(claim.createdAt)} МСК`,
  ].join("\n");

  const sent = await sendOpsTelegramGetMessageId("quality", text);
  if (sent) {
    await prisma.qualityClaim.update({
      where: { id: claim.id },
      data: { opsChatId: sent.chatId, opsMessageId: sent.messageId },
    });
  }
}

function opsStatusLabel(status: QualityClaimStatus): string {
  if (status === "approved") return "Одобрено";
  if (status === "rejected") return "Отклонено";
  return "Не рассмотрено";
}

export async function resolveQualityClaim(opts: {
  claimId: string;
  action: "approve" | "reject";
  actorId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const claim = await prisma.qualityClaim.findUnique({
    where: { id: opts.claimId },
    include: {
      user: { select: { locale: true } },
      galleryItem: { select: { kind: true } },
    },
  });
  if (!claim) return { ok: false, error: "Заявка не найдена" };
  if (claim.status !== "pending") {
    return { ok: false, error: "Уже рассмотрена" };
  }

  const status: QualityClaimStatus =
    opts.action === "approve" ? "approved" : "rejected";
  let refunded = 0;

  if (opts.action === "approve" && claim.chargedPeaches > 0) {
    await creditPeaches(claim.userId, claim.chargedPeaches, "qc_refund", {
      claimId: claim.id,
      galleryItemId: claim.galleryItemId,
      actorId: opts.actorId,
    });
    refunded = claim.chargedPeaches;
  }

  await prisma.qualityClaim.update({
    where: { id: claim.id },
    data: {
      status,
      refundedPeaches: refunded,
      reviewedById: opts.actorId,
      reviewedAt: new Date(),
    },
  });

  const locale: TgLocale = claim.user.locale?.startsWith("en") ? "en" : "ru";
  const kind =
    claim.kind === "video" || claim.galleryItem.kind === "video"
      ? "video"
      : "photo";

  if (claim.tgChatId && claim.tgMessageId) {
    await tgEditMessageReplyMarkup(
      claim.tgChatId,
      claim.tgMessageId,
      qcStatusKeyboard(locale, kind, status, claim.galleryItemId),
    ).catch(() => undefined);
  }

  const chatId = Number(claim.tgChatId);
  if (Number.isFinite(chatId) && chatId > 0) {
    const bal = (
      await prisma.user.findUnique({
        where: { id: claim.userId },
        select: { balancePeaches: true },
      })
    )?.balancePeaches;
    if (status === "approved") {
      await tgSendMessage(
        chatId,
        tFormat("qc_approved_notice", locale, {
          n: String(refunded),
          balance: String(bal ?? 0),
        }),
      ).catch(() => undefined);
    } else {
      await tgSendMessage(chatId, t("qc_rejected_notice", locale)).catch(
        () => undefined,
      );
    }
  }

  if (claim.opsChatId && claim.opsMessageId) {
    const { editOpsTelegramMessage, escHtml, formatMsk } = await import(
      "@/lib/ops/ops-telegram"
    );
    const totalClaims = await prisma.qualityClaim.count({
      where: { userId: claim.userId },
    });
    const text = [
      `<b>Контроль качества</b> · <b>${opsStatusLabel(status)}</b>`,
      ``,
      `Тип: <b>${kind === "video" ? "видео" : "фото"}</b>`,
      `Пользователь: <code>${escHtml(claim.userId)}</code>`,
      `Работа: <code>${escHtml(claim.galleryItemId)}</code>`,
      `Списано: <b>${claim.chargedPeaches}</b> 🍑` +
        (refunded ? ` → возврат <b>${refunded}</b>` : ""),
      `Заявок всего: <b>${totalClaims}</b>`,
      `Решено: ${formatMsk(new Date())} МСК`,
    ].join("\n");
    await editOpsTelegramMessage(
      claim.opsChatId,
      claim.opsMessageId,
      text,
    ).catch((e) => console.error("[qc] ops edit:", e));
  }

  return { ok: true };
}
