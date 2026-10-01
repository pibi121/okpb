/**
 * OPS Safety photo review queue for age-gate uncertain results.
 */
import { prisma } from "@/lib/db";
import fs from "fs";
import { resolveGalleryFile, saveGalleryBinary } from "@/lib/local-store";
import {
  ageGateApprovedMessage,
  ageGateBlockMessage,
  ageGatePhotoHash,
  ageGateUncertainMessage,
  type AgeGateResult,
} from "@/lib/age-gate";
import { tgNotifyUser } from "@/lib/tg/notify-user";
import { tgAnswerCallbackQuery, tgSendMessage } from "@/lib/tg/telegram-api";
import {
  ageGateAppealAllowed,
  ageGateAppealButtonText,
} from "@/lib/age-gate";

/** Callback prefix for the «Ей есть 18!» button: `ag18:<reviewId>`. */
export const AGE_GATE_APPEAL_CB = "ag18:";

const APPEAL_SENT_RU = "Отправили фото на проверку — сообщим, когда проверим.";
const APPEAL_SENT_EN = "Sent for review — we'll let you know once we've checked it.";

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
        meta: {
          reason,
          hash,
          appeal,
          engine: opts.result.engine || null,
        },
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

const OPS_CB_APPROVE = "agr:a:";
const OPS_CB_REJECT = "agr:r:";

type OpsMsgRef = { chatId: string; messageId: number };

function parseGateJson(json: string): Record<string, unknown> {
  try {
    const v = JSON.parse(json || "{}");
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function readOpsRef(gateJson: string): OpsMsgRef | null {
  const ops = parseGateJson(gateJson)._ops as Partial<OpsMsgRef> | undefined;
  if (ops?.chatId && typeof ops.messageId === "number") {
    return { chatId: String(ops.chatId), messageId: ops.messageId };
  }
  return null;
}

async function saveOpsRef(reviewId: string, ref: OpsMsgRef): Promise<void> {
  const row = await prisma.ageGateReview.findUnique({
    where: { id: reviewId },
    select: { gateJson: true },
  });
  if (!row) return;
  const gate = parseGateJson(row.gateJson);
  gate._ops = ref;
  await prisma.ageGateReview.update({
    where: { id: reviewId },
    data: { gateJson: JSON.stringify(gate) },
  });
}

function opsKeyboard(reviewId: string): Record<string, unknown> {
  return {
    inline_keyboard: [
      [
        {
          text: "✅ Одобрить (18+)",
          callback_data: `${OPS_CB_APPROVE}${reviewId}`,
        },
        {
          text: "⛔ Заблокировать",
          callback_data: `${OPS_CB_REJECT}${reviewId}`,
        },
      ],
    ],
  };
}

function opsStatusLabel(status: string): string {
  if (status === "approved") return "✅ Одобрено";
  if (status === "rejected") return "⛔ Заблокировано";
  return "⏳ Не рассмотрено";
}

async function buildOpsCaption(
  reviewId: string,
  resolvedBy?: string,
): Promise<string | null> {
  const { escHtml, formatMsk } = await import("@/lib/ops/ops-telegram");
  const row = await prisma.ageGateReview.findUnique({
    where: { id: reviewId },
  });
  if (!row) return null;
  const gate = parseGateJson(row.gateJson) as {
    reason?: string;
    ageLabel?: string;
    ageYears?: number;
    score?: number;
    rawAgeYears?: number;
    gilOverride?: boolean;
    face?: { gilLabel?: string; gilScore?: number };
    engine?: string;
    apiModel?: string;
    apiAgeMin?: number | null;
    apiAgeMax?: number | null;
    apiConfidence?: string;
  };
  const acc = await prisma.platformAccount.findFirst({
    where: { userId: row.userId, platform: "telegram" },
    orderBy: { lastSeenAt: "desc" },
    select: { username: true, platformUserId: true },
  });
  const who = acc?.username
    ? `@${escHtml(acc.username)} (${escHtml(acc.platformUserId)})`
    : `<code>${escHtml(row.userId)}</code>`;
  const age =
    gate.ageYears != null
      ? `~${Math.round(gate.ageYears)} лет`
      : gate.ageLabel || "—";
  const isApi = gate.engine === "api";
  const refusal = gate.reason === "model_refusal";
  const apiEstimate =
    gate.apiAgeMin != null
      ? `Оценка API: ${gate.apiAgeMin}–${gate.apiAgeMax ?? gate.apiAgeMin} лет` +
        (gate.apiConfidence ? ` (${escHtml(gate.apiConfidence)})` : "") +
        ` · модель ${escHtml(gate.apiModel || "?")}`
      : `Оценка API: модель не дала оценку · модель ${escHtml(gate.apiModel || "?")}`;
  const lines = [
    refusal
      ? `🔞 <b>Age Gate · ручная проверка</b> (модель отказалась оценивать)`
      : `🔞 <b>Age Gate · ручная проверка</b> («Ей есть 18!»)`,
    `Статус: <b>${opsStatusLabel(row.status)}</b>`,
    `Кто: ${who}`,
    isApi
      ? apiEstimate
      : `Оценка: ${escHtml(String(age))}${gate.score != null ? ` · score ${gate.score}` : ""}`,
    `Причина: ${escHtml(gate.reason || "—")}`,
    ...(!isApi && gate.rawAgeYears != null
      ? [
          `Детали: модель возраста ${Math.round(gate.rawAgeYears * 10) / 10} лет` +
            (gate.face?.gilLabel
              ? ` · доп. проверка ${escHtml(gate.face.gilLabel)} ${gate.face.gilScore ?? "—"}`
              : "") +
            (gate.gilOverride ? " · ⚠ занижено доп. проверкой" : ""),
        ]
      : []),
    `Заявка: <code>${escHtml(row.id)}</code>`,
    `Подана: ${formatMsk(row.createdAt)} МСК`,
  ];
  if (row.status !== "pending" && row.status !== "blocked") {
    lines.push(
      `Решено: ${escHtml(resolvedBy || "OPS")} · ${formatMsk(row.reviewedAt || new Date())} МСК`,
    );
  }
  return lines.join("\n");
}

/** New appeal → photo + buttons in the ops chat (status «Не рассмотрено»). */
async function notifyOpsAgeGateAppeal(reviewId: string): Promise<void> {
  const ops = await import("@/lib/ops/ops-telegram");
  if (!ops.opsTelegramConfigured()) return;
  const row = await prisma.ageGateReview.findUnique({
    where: { id: reviewId },
  });
  if (!row) return;
  const caption = await buildOpsCaption(reviewId);
  if (!caption) return;

  const abs = resolveGalleryFile(row.photoRelKey);
  let bytes: Buffer | null = null;
  try {
    bytes = abs ? fs.readFileSync(abs) : null;
  } catch {
    bytes = null;
  }

  if (bytes?.length) {
    const sent = await ops.sendOpsTelegramPhoto(
      "quality",
      bytes,
      caption,
      opsKeyboard(reviewId),
    );
    if (sent) await saveOpsRef(reviewId, sent);
    return;
  }
  // Photo file missing → text only; decide in OPS → Безопасность.
  await ops.sendOpsTelegram(
    "quality",
    `${caption}\n⚠️ Файл фото недоступен — решение в OPS → Безопасность.`,
  );
}

/** Reflect the current status in the ops chat message and remove its buttons. */
async function syncOpsAgeGateMessage(
  reviewId: string,
  resolvedBy?: string,
): Promise<void> {
  const row = await prisma.ageGateReview.findUnique({
    where: { id: reviewId },
    select: { gateJson: true },
  });
  if (!row) return;
  const ref = readOpsRef(row.gateJson);
  if (!ref) return;
  const caption = await buildOpsCaption(reviewId, resolvedBy);
  if (!caption) return;
  const { editOpsTelegramCaption } = await import("@/lib/ops/ops-telegram");
  await editOpsTelegramCaption(ref.chatId, ref.messageId, caption);
}

type OpsCallbackQuery = {
  id: string;
  data?: string;
  from?: { id: number; username?: string; first_name?: string };
  message?: { chat: { id: number } };
};

/**
 * Buttons under the ops-chat message: `agr:a:<id>` approve / `agr:r:<id>` reject.
 * Returns true if the callback belonged to this feature (handled).
 * `token` = bot that received the callback (ops bot or product bot).
 */
export async function handleOpsModerationCallback(
  cq: OpsCallbackQuery,
  token?: string,
): Promise<boolean> {
  const data = cq.data || "";
  const approve = data.startsWith(OPS_CB_APPROVE);
  const reject = data.startsWith(OPS_CB_REJECT);
  if (!approve && !reject) return false;

  const { opsTelegramChatId } = await import("@/lib/ops/ops-telegram");
  const opsChat = opsTelegramChatId();
  if (!opsChat || String(cq.message?.chat.id) !== opsChat) {
    await tgAnswerCallbackQuery(cq.id, "Нет доступа", token);
    return true;
  }

  const id = data.slice(approve ? OPS_CB_APPROVE.length : OPS_CB_REJECT.length);
  const actor = cq.from?.username
    ? `@${cq.from.username}`
    : cq.from?.first_name || String(cq.from?.id || "tg");
  try {
    const out = await resolveAgeGateReview({
      id,
      decision: approve ? "approved" : "rejected",
      opsUserId: `tg:${cq.from?.id ?? "?"}`,
      actorLabel: actor,
    });
    const changedNow =
      (approve && out.status === "approved") ||
      (reject && out.status === "rejected");
    await tgAnswerCallbackQuery(
      cq.id,
      changedNow
        ? approve
          ? "Одобрено"
          : "Заблокировано"
        : `Уже рассмотрено: ${opsStatusLabel(out.status)}`,
      token,
    );
  } catch (e) {
    await tgAnswerCallbackQuery(
      cq.id,
      e instanceof Error ? e.message.slice(0, 180) : "Ошибка",
      token,
    );
  }
  return true;
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
  const userText = ageGateUncertainMessage(opts.locale, opts.result.reason);
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
        text: userText,
      }).catch(() => undefined);
    }
    return {
      reviewId: existing.id,
      duplicate: true,
      photoUrl: existing.photoUrl,
    };
  }

  // Anti-abuse: same daily cap as appeals — over it the row is still stored
  // (user gets the message) but staff chat isn't spammed.
  const dayCount = await prisma.ageGateReview.count({
    where: {
      userId: opts.userId,
      createdAt: { gte: new Date(Date.now() - 24 * 3600_000) },
    },
  });

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

  if (dayCount < 10) {
    void notifyOpsAgeGateAppeal(row.id).catch((e) =>
      console.error("[age-gate] ops notify:", e),
    );
  }

  if (opts.notifyUser !== false) {
    await tgNotifyUser({
      userId: opts.userId,
      text: userText,
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
  /** Who decided, for the ops-chat message («@user», «OPS-панель»). */
  actorLabel?: string;
}): Promise<{ ok: true; status: string; userId: string }> {
  const row = await prisma.ageGateReview.findUnique({ where: { id: opts.id } });
  if (!row) throw new Error("review not found");
  if (row.status !== "pending") {
    // Already decided (or not appealed yet): just refresh/clear the ops-chat buttons.
    if (row.status !== "blocked") {
      void syncOpsAgeGateMessage(row.id).catch(() => undefined);
    }
    return { ok: true, status: row.status, userId: row.userId };
  }

  // Atomic claim: two staff pressing at once → only one applies.
  const claimed = await prisma.ageGateReview.updateMany({
    where: { id: row.id, status: "pending" },
    data: {
      status: opts.decision,
      reviewedAt: new Date(),
      reviewedByOpsUserId: opts.opsUserId,
    },
  });
  if (claimed.count === 0) {
    const cur = await prisma.ageGateReview.findUnique({
      where: { id: row.id },
      select: { status: true },
    });
    return { ok: true, status: cur?.status || row.status, userId: row.userId };
  }

  await syncOpsAgeGateMessage(
    row.id,
    opts.actorLabel || "OPS-панель",
  ).catch((e) => console.error("[age-gate] ops sync:", e));

  const locale = row.locale === "en" ? "en" : "ru";
  const text =
    opts.decision === "approved"
      ? ageGateApprovedMessage(locale)
      : ageGateBlockMessage(locale, "probable_minor");

  await tgNotifyUser({ userId: row.userId, text }).catch(() => undefined);

  return { ok: true, status: opts.decision, userId: row.userId };
}
