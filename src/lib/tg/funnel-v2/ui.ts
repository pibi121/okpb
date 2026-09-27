/**
 * Funnel v2 UI carrier: one navigable message at a time.
 * Deletes the previous menu/confirm before sending the next.
 * Generation results (outbox) are never tracked here — they stay in chat.
 */
import { getTgSession, parsePending, setTgSession } from "@/lib/tg/session";
import { tgDeleteMessage } from "@/lib/tg/telegram-api";

type TgMsg = { message_id?: number } | null | undefined;

function extractMessageId(sent: TgMsg): number | undefined {
  if (!sent || typeof sent !== "object") return undefined;
  const id = (sent as { message_id?: unknown }).message_id;
  return typeof id === "number" && Number.isFinite(id) ? id : undefined;
}

async function readUiMessageId(
  platformUserId: string,
): Promise<number | undefined> {
  try {
    const acc = await getTgSession(platformUserId);
    const id = parsePending(acc?.pendingJson || "{}").funnelV2UiMessageId;
    return typeof id === "number" ? id : undefined;
  } catch {
    return undefined;
  }
}

async function writeUiMessageId(
  platformUserId: string,
  messageId: number | undefined,
): Promise<void> {
  await setTgSession(platformUserId, {
    pending: { funnelV2UiMessageId: messageId },
  }).catch(() => undefined);
}

/** Delete tracked UI message (if any) and clear the pointer. */
export async function funnelV2DropUi(
  platformUserId: string,
  chatId: number,
): Promise<void> {
  const prev = await readUiMessageId(platformUserId);
  if (prev) {
    try {
      await tgDeleteMessage(chatId, prev);
    } catch {
      /* already gone */
    }
  }
  await writeUiMessageId(platformUserId, undefined);
}

/**
 * Replace the previous funnel UI message with a new one.
 * `send` must return Telegram's Message (or at least `{ message_id }`).
 */
export async function funnelV2ReplaceUi(
  platformUserId: string,
  chatId: number,
  send: () => Promise<unknown>,
): Promise<number | undefined> {
  const prev = await readUiMessageId(platformUserId);
  if (prev) {
    try {
      await tgDeleteMessage(chatId, prev);
    } catch {
      /* ignore */
    }
  }

  const sent = await send();
  const mid = extractMessageId(sent as TgMsg);
  await writeUiMessageId(platformUserId, mid);
  return mid;
}
