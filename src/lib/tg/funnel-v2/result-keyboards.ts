import type { TgLocale } from "@/lib/tg/i18n";
import { t } from "@/lib/tg/i18n";
import { FV2 } from "@/lib/tg/funnel-v2/callbacks";
import { QC_CB } from "@/lib/tg/generation-flow";
import { funnelV2TopupPackRows } from "@/lib/tg/funnel-v2/topup";

export type FunnelV2PhotoKbOpts = {
  /** Paid undress / photo-template only — not blur, edit, video, animate. */
  offerQcDislike?: boolean;
  qcStatus?: "idle" | "pending" | "approved" | "rejected";
};

/** After successful funnel photo (full quality). */
export function funnelV2PhotoReadyKeyboard(
  locale: TgLocale,
  galleryItemId: string,
  opts?: FunnelV2PhotoKbOpts,
) {
  const rows: Array<Array<Record<string, unknown>>> = [
    [
      {
        text: "Редактировать фото ✏️",
        callback_data: FV2.phEdit(galleryItemId),
        style: "success",
      },
      {
        text: "Оживить фото 🎬",
        callback_data: FV2.phAnim(galleryItemId),
        style: "danger",
      },
    ],
    [{ text: "Выбрать другой шаблон 💦", callback_data: FV2.photo }],
    [{ text: "⬅️ Вернуться в главное меню", callback_data: FV2.hub }],
  ];

  const qc = opts?.qcStatus || "idle";
  if (opts?.offerQcDislike || (qc && qc !== "idle")) {
    if (qc === "pending") {
      rows.push([
        {
          text: t("qc_btn_pending", locale),
          callback_data: QC_CB.status(galleryItemId),
        },
      ]);
    } else if (qc === "approved") {
      rows.push([
        {
          text: t("qc_btn_approved", locale),
          callback_data: QC_CB.status(galleryItemId),
        },
      ]);
    } else if (qc === "rejected") {
      rows.push([
        {
          text: t("qc_btn_rejected", locale),
          callback_data: QC_CB.status(galleryItemId),
        },
      ]);
    } else if (opts?.offerQcDislike) {
      rows.push([
        {
          text: t("qc_dislike_photo_btn", locale),
          callback_data: QC_CB.dislike(galleryItemId),
        },
      ]);
    }
  }

  return { inline_keyboard: rows };
}

/** Blur trial: pack amounts + back to hub (TZ). */
export function funnelV2PhotoBlurKeyboard(
  _locale: TgLocale,
  _opts?: { pricePeaches?: number; galleryItemId?: string },
) {
  return {
    inline_keyboard: [
      ...funnelV2TopupPackRows({ fromBlur: true }),
      [{ text: "⬅️ Назад", callback_data: FV2.hub }],
    ],
  };
}

export function funnelV2VideoReadyKeyboard(_locale: TgLocale) {
  return {
    inline_keyboard: [
      [{ text: "Выбрать другой шаблон 🍓", callback_data: FV2.video }],
      [{ text: "⬅️ Вернуться в главное меню", callback_data: FV2.hub }],
    ],
  };
}
