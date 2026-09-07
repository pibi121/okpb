const API = "https://api.telegram.org/bot";

function botToken(): string {
  const t = process.env.TELEGRAM_BOT_TOKEN;
  if (!t) throw new Error("TELEGRAM_BOT_TOKEN is not set");
  return t;
}

function baseUrl(): string {
  return `${API}${botToken()}`;
}

export async function tgApi<T = unknown>(
  method: string,
  body?: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(`${baseUrl()}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json()) as { ok: boolean; result?: T; description?: string };
  if (!json.ok) throw new Error(json.description || method);
  return json.result as T;
}

export async function tgSendMessage(
  chatId: number | string,
  text: string,
  extra: Record<string, unknown> = {},
) {
  return tgApi("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    ...extra,
  });
}

export async function tgEditMessageText(
  chatId: number | string,
  messageId: number,
  text: string,
  extra: Record<string, unknown> = {},
) {
  return tgApi("editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: "HTML",
    ...extra,
  });
}

export async function tgEditMessageCaption(
  chatId: number | string,
  messageId: number,
  caption: string,
  extra: Record<string, unknown> = {},
) {
  return tgApi("editMessageCaption", {
    chat_id: chatId,
    message_id: messageId,
    caption,
    parse_mode: "HTML",
    ...extra,
  });
}

export async function tgEditMessageReplyMarkup(
  chatId: number | string,
  messageId: number,
  replyMarkup: Record<string, unknown>,
) {
  return tgApi("editMessageReplyMarkup", {
    chat_id: chatId,
    message_id: messageId,
    reply_markup: replyMarkup,
  });
}

export async function tgSendPhoto(
  chatId: number | string,
  photoUrl: string,
  caption?: string,
  extra: Record<string, unknown> = {},
) {
  return tgApi("sendPhoto", {
    chat_id: chatId,
    photo: photoUrl,
    caption,
    parse_mode: "HTML",
    ...extra,
  });
}

export async function tgSendVideo(
  chatId: number | string,
  videoUrl: string,
  caption?: string,
  extra: Record<string, unknown> = {},
) {
  return tgApi("sendVideo", {
    chat_id: chatId,
    video: videoUrl,
    caption,
    parse_mode: "HTML",
    supports_streaming: true,
    ...extra,
  });
}

export async function tgSendAnimation(
  chatId: number | string,
  animation: string,
  extra: Record<string, unknown> = {},
) {
  return tgApi("sendAnimation", {
    chat_id: chatId,
    animation,
    parse_mode: "HTML",
    ...extra,
  });
}

/** Telegram video note (кругляшок). `videoNote` = file_id or HTTPS URL. */
export async function tgSendVideoNote(
  chatId: number | string,
  videoNote: string,
  extra: Record<string, unknown> = {},
) {
  return tgApi("sendVideoNote", {
    chat_id: chatId,
    video_note: videoNote,
    ...extra,
  });
}

export async function tgAnswerCallbackQuery(
  callbackQueryId: string,
  text?: string,
) {
  return tgApi("answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    ...(text ? { text, show_alert: false } : {}),
  });
}

export async function tgDownloadFile(fileId: string): Promise<Buffer> {
  const file = await tgApi<{ file_path: string }>("getFile", { file_id: fileId });
  const url = `https://api.telegram.org/file/bot${botToken()}/${file.file_path}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed: ${res.status}`);
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}
