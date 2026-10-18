import { prisma, withDbRetry } from "@/lib/db";

export type TgChatState =
  | "idle"
  | "awaiting_lang"
  | "awaiting_rules"
  | "onboarding_awaiting_upload"
  | "onboarding_awaiting_name"
  | "onboarding_awaiting_photos"
  | "awaiting_photos"
  | "awaiting_speech"
  | "awaiting_character_name"
  | "awaiting_character_rename"
  | "awaiting_topup_amount"
  | "awaiting_topup_method"
  | "awaiting_lookbook_custom"
  | "awaiting_video_ref_name"
  | "awaiting_undress_photo"
  | "funnel_v2_awaiting_rules"
  | "funnel_v2_awaiting_photo"
  | "funnel_v2_awaiting_edit"
  | "funnel_v2_awaiting_partner_label";

export type TgPending = {
  templateId?: string;
  templateKind?: "video" | "photo";
  templatePage?: number;
  templateIds?: string[];
  pricePeaches?: number;
  title?: string;
  hasSpeech?: boolean;
  speechLine?: string;
  /** Multi-slot dialogue fills while editing */
  speechFills?: Array<{ id: string; text: string; lang?: string }>;
  /** Index of slot currently being edited in bot */
  speechSlotIndex?: number;
  /** Snapshot of slots for the selected template */
  speechSlots?: Array<{
    id: string;
    speaker: string;
    lang: string;
    text: string;
    label?: string;
    maxChars?: number;
  }>;
  /** Best quality (LoRA→I2V) — needs trained character */
  requiresLora?: boolean;
  /** Bot video catalog filter after mode picker */
  videoMode?: "one_photo" | "look";
  renameCharacterId?: string;
  onboardingCharacterId?: string;
  lookbookCharacterId?: string;
  lookbookFieldId?: string;
  discountApplied?: boolean;
  freePhoto?: boolean;
  studioDaily?: boolean;
  loraWelcome?: boolean;
  /** Temp character for video ref photo upload */
  videoUploadCharacterId?: string;
  /** Single editable upload progress message */
  uploadProgressMessageId?: number;
  /** Studio cast id when generating photo from mini app */
  studioCastId?: string;
  /** Pending peach amount while choosing SBP/crypto */
  topupPeaches?: number;
  /** Bonus peaches credited on top of paid amount (funnel packs). */
  topupBonusPeaches?: number;
  /** Cast picker page on photo confirm */
  castPage?: number;
  /** Video model/ref picker mode after pose confirm */
  videoCastMode?: "lora" | "ref";
  /** Message id of photo confirm (for inline edit) */
  confirmMessageId?: number;
  /** Confirm message is photo/video (edit caption) vs text */
  confirmHasMedia?: boolean;
  /** Auto-send rules after start pitch (epoch ms) */
  rulesAutoAt?: number;
  /** Rules already auto-sent for this onboarding attempt */
  rulesAutoSent?: boolean;
  /** QC: gallery item waiting confirm */
  qcItemId?: string;
  /** QC: success keyboard message id to edit */
  qcSuccessMessageId?: number;
  funnelV2PhotoUrl?: string;
  funnelV2PhotoKey?: string;
  /** Optional second hero for dual-cast QuickVideo templates. */
  funnelV2Photo2Url?: string;
  funnelV2Photo2Key?: string;
  /** Next funnel_v2_awaiting_photo upload goes to photo2, not photo1. */
  funnelV2AwaitPhoto2?: boolean;
  funnelV2AwaitReplace?: boolean;
  funnelV2PendingConfirm?: { kind: "ud" | "tpl"; id: string };
  funnelV2PendingVideoConfirm?: { kind: "qv" | "li2v"; id: string };
  funnelV2ReturnTo?: "video" | "photo";
  funnelV2EditItemId?: string;
  funnelV2TopupPeaches?: number;
  funnelV2TopupBonus?: number;
  /** @deprecated Legacy faststart flag; cleared on photo upload, unused. */
  funnelV2FaststartRandom?: boolean;
  /** After blur: topup should charge + regenerate clear photo */
  funnelV2Unblur?: {
    galleryItemId: string;
    kind: "ud" | "tpl";
    templateId: string;
    photoUrl: string;
    photoKey?: string;
    price: number;
    poseTitle: string;
  };
  /** After plain topup from blur screen → open hub */
  funnelV2ReturnHubAfterTopup?: boolean;
  /** Last silent message that carries the bottom reply keyboard */
  replyKbCarrierId?: number;
  /** Funnel v2 navigable UI message (menus/confirms) — replaced on each step */
  funnelV2UiMessageId?: number;
};

export async function getTgSession(platformUserId: string) {
  return withDbRetry(() =>
    prisma.platformAccount.findUnique({
      where: {
        platform_platformUserId: { platform: "telegram", platformUserId },
      },
      include: { user: true },
    }),
  );
}

export function parsePending(raw: string): TgPending {
  try {
    return JSON.parse(raw || "{}") as TgPending;
  } catch {
    return {};
  }
}

export async function setTgSession(
  platformUserId: string,
  patch: {
    chatState?: TgChatState;
    pending?: TgPending;
    clearPending?: boolean;
  },
) {
  const acc = await withDbRetry(() =>
    prisma.platformAccount.findUnique({
      where: {
        platform_platformUserId: { platform: "telegram", platformUserId },
      },
    }),
  );
  if (!acc) return null;

  const prevPending = parsePending(acc.pendingJson);
  const pending: TgPending = {
    ...(patch.clearPending ? {} : prevPending),
    ...(patch.pending || {}),
  };
  // Keep the reply-keyboard carrier across clearPending — deleting that
  // message on some Telegram clients also drops the bottom keyboard.
  if (
    patch.clearPending &&
    prevPending.replyKbCarrierId != null &&
    patch.pending?.replyKbCarrierId === undefined
  ) {
    pending.replyKbCarrierId = prevPending.replyKbCarrierId;
  }
  // Funnel v2 UI carrier + ref photo + post-topup intents survive clears.
  if (patch.clearPending) {
    if (
      prevPending.funnelV2UiMessageId != null &&
      patch.pending?.funnelV2UiMessageId === undefined
    ) {
      pending.funnelV2UiMessageId = prevPending.funnelV2UiMessageId;
    }
    if (
      prevPending.funnelV2PhotoUrl &&
      patch.pending?.funnelV2PhotoUrl === undefined
    ) {
      pending.funnelV2PhotoUrl = prevPending.funnelV2PhotoUrl;
    }
    if (
      prevPending.funnelV2PhotoKey &&
      patch.pending?.funnelV2PhotoKey === undefined
    ) {
      pending.funnelV2PhotoKey = prevPending.funnelV2PhotoKey;
    }
    if (
      prevPending.funnelV2Photo2Url &&
      patch.pending?.funnelV2Photo2Url === undefined
    ) {
      pending.funnelV2Photo2Url = prevPending.funnelV2Photo2Url;
    }
    if (
      prevPending.funnelV2Photo2Key &&
      patch.pending?.funnelV2Photo2Key === undefined
    ) {
      pending.funnelV2Photo2Key = prevPending.funnelV2Photo2Key;
    }
    if (
      prevPending.funnelV2ReturnHubAfterTopup &&
      patch.pending?.funnelV2ReturnHubAfterTopup === undefined
    ) {
      pending.funnelV2ReturnHubAfterTopup = true;
    }
    if (
      prevPending.funnelV2Unblur &&
      patch.pending?.funnelV2Unblur === undefined
    ) {
      pending.funnelV2Unblur = prevPending.funnelV2Unblur;
    }
  }

  return withDbRetry(() =>
    prisma.platformAccount.update({
      where: { id: acc.id },
      data: {
        chatState: patch.chatState ?? acc.chatState,
        pendingJson: JSON.stringify(pending),
      },
    }),
  );
}

async function resolveOutboxBotId(
  platformUserId: string,
  payload: Record<string, unknown>,
): Promise<string> {
  let botInstanceId =
    typeof payload.botInstanceId === "string" ? payload.botInstanceId : "";
  if (!botInstanceId) {
    try {
      const { currentTgBot } = await import("@/lib/tg/bot-context");
      botInstanceId = currentTgBot()?.botInstanceId || "";
    } catch {
      /* ignore */
    }
  }
  if (!botInstanceId) {
    try {
      const acc = await prisma.platformAccount.findFirst({
        where: { platform: "telegram", platformUserId },
        select: { lastBotInstanceId: true },
      });
      botInstanceId = acc?.lastBotInstanceId || "";
    } catch {
      /* ignore */
    }
  }
  return botInstanceId;
}

function outboxPayloadJson(
  payload: Record<string, unknown>,
  botInstanceId: string,
): string {
  return JSON.stringify({
    ...payload,
    ...(botInstanceId ? { botInstanceId } : {}),
  });
}

export async function enqueueTgOutbox(opts: {
  platformUserId: string;
  userId: string;
  kind: "video" | "photo" | "text" | "error";
  payload: Record<string, unknown>;
}) {
  const botInstanceId = await resolveOutboxBotId(
    opts.platformUserId,
    opts.payload,
  );
  const galleryItemId =
    typeof opts.payload.galleryItemId === "string"
      ? opts.payload.galleryItemId.trim()
      : "";
  const dedupeKey =
    galleryItemId && (opts.kind === "photo" || opts.kind === "video")
      ? `${opts.userId}:${galleryItemId}:${opts.kind}`
      : null;
  try {
    await prisma.tgOutbox.create({
      data: {
        platformUserId: opts.platformUserId,
        userId: opts.userId,
        kind: opts.kind,
        payloadJson: outboxPayloadJson(opts.payload, botInstanceId),
        dedupeKey,
      },
    });
  } catch (e) {
    const code =
      e && typeof e === "object" && "code" in e
        ? String((e as { code?: string }).code || "")
        : "";
    if (code === "P2002") return;
    throw e;
  }
}

const OUTBOX_CLAIM_MS = 90_000;

/** One sender owns the row until it is marked sent or the claim expires. */
export async function claimTgOutboxSend(
  id: string,
): Promise<{ payloadJson: string } | null> {
  const row = await prisma.tgOutbox.findUnique({ where: { id } });
  if (!row || row.sentAt) return null;
  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(row.payloadJson || "{}") as Record<string, unknown>;
  } catch {
    payload = {};
  }
  const until = Number(payload.claimUntil || 0);
  if (Number.isFinite(until) && until > Date.now()) return null;
  const claimId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const payloadJson = JSON.stringify({
    ...payload,
    claimUntil: Date.now() + OUTBOX_CLAIM_MS,
    claimId,
  });
  const res = await prisma.tgOutbox.updateMany({
    where: { id, sentAt: null, payloadJson: row.payloadJson },
    data: { payloadJson },
  });
  if (res.count !== 1) return null;
  return { payloadJson };
}

/** Drop the send lock. Keeps mediaSent so a retry does not upload the file again. */
export async function releaseTgOutboxClaim(id: string, claimId: string) {
  const row = await prisma.tgOutbox.findUnique({ where: { id } });
  if (!row || row.sentAt) return;
  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(row.payloadJson || "{}") as Record<string, unknown>;
  } catch {
    return;
  }
  if (payload.claimId !== claimId) return;
  delete payload.claimUntil;
  delete payload.claimId;
  await prisma.tgOutbox.updateMany({
    where: { id, sentAt: null, payloadJson: row.payloadJson },
    data: { payloadJson: JSON.stringify(payload) },
  });
}

export async function listPendingTgOutbox(limit = 20) {
  return prisma.tgOutbox.findMany({
    where: { sentAt: null },
    orderBy: { createdAt: "asc" },
    take: limit,
  });
}

export async function markTgOutboxSent(id: string) {
  await prisma.tgOutbox.update({
    where: { id },
    data: { sentAt: new Date() },
  });
}
