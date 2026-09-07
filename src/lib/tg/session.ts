import { prisma } from "@/lib/db";

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
  | "awaiting_lookbook_custom"
  | "awaiting_video_ref_name";

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
  /** Cast picker page on photo confirm */
  castPage?: number;
  /** Message id of photo confirm (for inline edit) */
  confirmMessageId?: number;
  /** Confirm message is photo/video (edit caption) vs text */
  confirmHasMedia?: boolean;
};

export async function getTgSession(platformUserId: string) {
  return prisma.platformAccount.findUnique({
    where: {
      platform_platformUserId: { platform: "telegram", platformUserId },
    },
    include: { user: true },
  });
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
  const acc = await prisma.platformAccount.findUnique({
    where: {
      platform_platformUserId: { platform: "telegram", platformUserId },
    },
  });
  if (!acc) return null;

  const pending = {
    ...(patch.clearPending ? {} : parsePending(acc.pendingJson)),
    ...(patch.pending || {}),
  };

  return prisma.platformAccount.update({
    where: { id: acc.id },
    data: {
      chatState: patch.chatState ?? acc.chatState,
      pendingJson: JSON.stringify(pending),
    },
  });
}

export async function enqueueTgOutbox(opts: {
  platformUserId: string;
  userId: string;
  kind: "video" | "photo" | "text" | "error";
  payload: Record<string, unknown>;
}) {
  await prisma.tgOutbox.create({
    data: {
      platformUserId: opts.platformUserId,
      userId: opts.userId,
      kind: opts.kind,
      payloadJson: JSON.stringify(opts.payload),
    },
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
