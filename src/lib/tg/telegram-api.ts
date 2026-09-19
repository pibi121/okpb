import { currentTgBotToken } from "@/lib/tg/bot-context";

const API = "https://api.telegram.org/bot";

function resolveToken(explicit?: string): string {
  const t =
    explicit?.trim() ||
    currentTgBotToken() ||
    process.env.TELEGRAM_BOT_TOKEN?.trim() ||
    "";
  if (!t) throw new Error("TELEGRAM_BOT_TOKEN is not set");
  return t;
}

export async function tgApiWithToken<T = unknown>(
  token: string,
  method: string,
  body?: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(`${API}${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json()) as { ok: boolean; result?: T; description?: string };
  if (!json.ok) throw new Error(json.description || method);
  return json.result as T;
}

export async function tgApi<T = unknown>(
  method: string,
  body?: Record<string, unknown>,
  token?: string,
): Promise<T> {
  return tgApiWithToken(resolveToken(token), method, body);
}

export async function tgSendMessage(
  chatId: number | string,
  text: string,
  extra: Record<string, unknown> = {},
  token?: string,
) {
  // _peachSkipInbox kept for callers; ops inbox no longer mirrors auto bot texts.
  const { _peachSkipInbox: _ignored, ...apiExtra } = extra;
  return tgApi(
    "sendMessage",
    {
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      ...apiExtra,
    },
    token,
  );
}

export async function tgEditMessageText(
  chatId: number | string,
  messageId: number,
  text: string,
  extra: Record<string, unknown> = {},
  token?: string,
) {
  return tgApi(
    "editMessageText",
    {
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: "HTML",
      ...extra,
    },
    token,
  );
}

export async function tgEditMessageCaption(
  chatId: number | string,
  messageId: number,
  caption: string,
  extra: Record<string, unknown> = {},
  token?: string,
) {
  return tgApi(
    "editMessageCaption",
    {
      chat_id: chatId,
      message_id: messageId,
      caption,
      parse_mode: "HTML",
      ...extra,
    },
    token,
  );
}

export async function tgEditMessageReplyMarkup(
  chatId: number | string,
  messageId: number,
  replyMarkup: Record<string, unknown>,
  token?: string,
) {
  return tgApi(
    "editMessageReplyMarkup",
    {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: replyMarkup,
    },
    token,
  );
}

export async function tgDeleteMessage(
  chatId: number | string,
  messageId: number,
  token?: string,
) {
  return tgApi(
    "deleteMessage",
    {
      chat_id: chatId,
      message_id: messageId,
    },
    token,
  );
}

export async function tgApiForm<T = unknown>(
  method: string,
  form: FormData,
  token?: string,
): Promise<T> {
  const tok = resolveToken(token);
  const res = await fetch(`${API}${tok}/${method}`, {
    method: "POST",
    body: form,
  });
  const json = (await res.json()) as {
    ok: boolean;
    result?: T;
    description?: string;
  };
  if (!json.ok) throw new Error(json.description || method);
  return json.result as T;
}

export async function tgSendPhoto(
  chatId: number | string,
  photoUrl: string,
  caption?: string,
  extra: Record<string, unknown> = {},
  token?: string,
) {
  return tgApi(
    "sendPhoto",
    {
      chat_id: chatId,
      photo: photoUrl,
      caption,
      parse_mode: "HTML",
      ...extra,
    },
    token,
  );
}

/** Upload photo bytes (private /api/media gallery is not fetchable by Telegram). */
export async function tgSendPhotoFile(
  chatId: number | string,
  bytes: Buffer,
  filename = "photo.jpg",
  caption?: string,
  extra: Record<string, unknown> = {},
  token?: string,
) {
  const form = new FormData();
  form.append("chat_id", String(chatId));
  form.append(
    "photo",
    new Blob([new Uint8Array(bytes)], { type: mimeFromName(filename) }),
    filename,
  );
  if (caption) form.append("caption", caption);
  form.append("parse_mode", "HTML");
  for (const [k, v] of Object.entries(extra)) {
    if (v == null) continue;
    form.append(k, typeof v === "string" ? v : JSON.stringify(v));
  }
  return tgApiForm("sendPhoto", form, token);
}

export async function tgSendVideo(
  chatId: number | string,
  videoUrl: string,
  caption?: string,
  extra: Record<string, unknown> = {},
  token?: string,
) {
  return tgApi(
    "sendVideo",
    {
      chat_id: chatId,
      video: videoUrl,
      caption,
      parse_mode: "HTML",
      supports_streaming: true,
      ...extra,
    },
    token,
  );
}

/** Upload video bytes — same reason as tgSendPhotoFile. */
export async function tgSendVideoFile(
  chatId: number | string,
  bytes: Buffer,
  filename = "video.mp4",
  caption?: string,
  extra: Record<string, unknown> = {},
  token?: string,
) {
  const form = new FormData();
  form.append("chat_id", String(chatId));
  form.append(
    "video",
    new Blob([new Uint8Array(bytes)], { type: mimeFromName(filename) }),
    filename,
  );
  if (caption) form.append("caption", caption);
  form.append("parse_mode", "HTML");
  form.append("supports_streaming", "true");
  for (const [k, v] of Object.entries(extra)) {
    if (v == null) continue;
    form.append(k, typeof v === "string" ? v : JSON.stringify(v));
  }
  return tgApiForm("sendVideo", form, token);
}

function mimeFromName(name: string): string {
  const n = name.toLowerCase();
  if (n.endsWith(".png")) return "image/png";
  if (n.endsWith(".webp")) return "image/webp";
  if (n.endsWith(".gif")) return "image/gif";
  if (n.endsWith(".webm")) return "video/webm";
  if (n.endsWith(".mov")) return "video/quicktime";
  if (n.endsWith(".mp4")) return "video/mp4";
  if (n.endsWith(".jpg") || n.endsWith(".jpeg")) return "image/jpeg";
  return "application/octet-stream";
}

export async function tgSendAnimation(
  chatId: number | string,
  animation: string,
  extra: Record<string, unknown> = {},
  token?: string,
) {
  return tgApi(
    "sendAnimation",
    {
      chat_id: chatId,
      animation,
      parse_mode: "HTML",
      ...extra,
    },
    token,
  );
}

/** Telegram video note (кругляшок). `videoNote` = file_id or HTTPS URL. */
export async function tgSendVideoNote(
  chatId: number | string,
  videoNote: string,
  extra: Record<string, unknown> = {},
  token?: string,
) {
  return tgApi(
    "sendVideoNote",
    {
      chat_id: chatId,
      video_note: videoNote,
      ...extra,
    },
    token,
  );
}

export async function tgAnswerCallbackQuery(
  callbackQueryId: string,
  text?: string,
  token?: string,
) {
  return tgApi(
    "answerCallbackQuery",
    {
      callback_query_id: callbackQueryId,
      ...(text ? { text, show_alert: false } : {}),
    },
    token,
  );
}

export async function tgDownloadFile(fileId: string, token?: string): Promise<Buffer> {
  const tok = resolveToken(token);
  const file = await tgApiWithToken<{ file_path: string }>(tok, "getFile", {
    file_id: fileId,
  });
  const url = `https://api.telegram.org/file/bot${tok}/${file.file_path}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed: ${res.status}`);
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}

/** Blue chat menu button next to the attach field (replaces default "Open"). */
export async function tgSetChatMenuButtonStudio(opts?: {
  text?: string;
  url?: string;
  token?: string;
}) {
  const { tgMiniAppUrl } = await import("@/lib/tg/miniapp-url");
  const text = (opts?.text || "Студия").slice(0, 16);
  const url = opts?.url || tgMiniAppUrl();
  return tgApi(
    "setChatMenuButton",
    {
      menu_button: {
        type: "web_app",
        text,
        web_app: { url },
      },
    },
    opts?.token,
  );
}
