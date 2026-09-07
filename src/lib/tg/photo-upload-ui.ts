import {
  normalizeLocale,
  t,
  tFormat,
  type TgLocale,
} from "@/lib/tg/i18n";
import { setTgSession, parsePending, type TgPending } from "@/lib/tg/session";
import { tgEditMessageText, tgSendMessage } from "@/lib/tg/telegram-api";
import { GEN_CB, VID_CB } from "@/lib/tg/generation-flow";

export type PhotoUploadMode = "video_ref" | "character" | "onboarding_lora";

function buildProgressText(
  locale: TgLocale,
  mode: PhotoUploadMode,
  accepted: number,
  max: number,
  min: number,
): { text: string; reply_markup?: Record<string, unknown> } {
  const need = Math.max(0, min - accepted);
  let extra = "";
  if (mode === "video_ref") {
    if (need > 0) {
      extra = tFormat("upload_need_more", locale, { n: need });
    } else if (accepted < max) {
      extra = t("upload_video_can_add_more", locale);
    } else {
      extra = t("upload_video_max_reached", locale);
    }
  } else if (need > 0) {
    extra = tFormat("upload_need_more", locale, { n: need });
  } else {
    extra = t("upload_min_reached", locale);
  }

  const text = tFormat("upload_progress", locale, {
    accepted,
    need: need > 0 ? need : 0,
    extra,
  });

  const reply_markup =
    mode === "video_ref" && accepted >= min
      ? {
          inline_keyboard: [
            [{ text: t("upload_done_btn", locale), callback_data: VID_CB.photosDone }],
          ],
        }
      : undefined;

  return { text, reply_markup };
}

/** One live message for photo upload progress — edit in place when possible. */
export async function showPhotoUploadProgress(opts: {
  chatId: number;
  platformUserId: string;
  locale: TgLocale;
  pending: TgPending;
  mode: PhotoUploadMode;
  accepted: number;
  max: number;
  min: number;
}) {
  const { text, reply_markup } = buildProgressText(
    opts.locale,
    opts.mode,
    opts.accepted,
    opts.max,
    opts.min,
  );

  const msgId = opts.pending.uploadProgressMessageId;
  if (msgId) {
    try {
      await tgEditMessageText(opts.chatId, msgId, text, reply_markup ? { reply_markup } : {});
      return;
    } catch {
      /* message too old or deleted — send fresh */
    }
  }

  const sent = await tgSendMessage(opts.chatId, text, reply_markup ? { reply_markup } : {});
  const newId = (sent as { message_id?: number })?.message_id;
  if (newId) {
    await setTgSession(opts.platformUserId, {
      pending: { ...opts.pending, uploadProgressMessageId: newId },
    });
  }
}

export function localeFromPending(raw: string | null | undefined): TgLocale {
  return normalizeLocale(raw || "ru");
}

export { parsePending };
