/**
 * Funnel v2 — оживить фото (4 / 7 / 12 сек) from PhotoTemplate.animateJson.
 * 4s is the MiniMax I2V minimum (TZ had 3s).
 */
import { prisma } from "@/lib/db";
import type { TgLocale } from "@/lib/tg/i18n";
import { peachesToUsdt, videoPeachesForSec } from "@/lib/tg-pricing";
import { tgSendMessage } from "@/lib/tg/telegram-api";
import { setTgSession } from "@/lib/tg/session";
import { FV2 } from "@/lib/tg/funnel-v2/callbacks";
import {
  debitFunnelBalance,
  getFunnelBalance,
} from "@/lib/tg/funnel-v2/mode";
import { sendCoverPhoto } from "@/lib/tg/funnel-v2/media";
import {
  ANIMATE_DURATIONS_SEC,
  animatePromptForDuration,
  parsePhotoAnimateConfig,
} from "@/lib/photo-template-animate";
import { enqueuePhotoEditAnimatePreview } from "@/lib/photo-edit-preview-animate";
import { parseGalleryMeta, GALLERY_PLACEHOLDER_URL } from "@/lib/gallery-meta";
import { tgAbsoluteUrl } from "@/lib/tg/media-assets";
import { funnelV2ReplaceUi } from "@/lib/tg/funnel-v2/ui";

function priceLine(peaches: number): string {
  return `${peaches}🍑 (${peaches} рублей / ${peachesToUsdt(peaches)}$)`;
}

async function resolveTemplateIdForItem(
  userId: string,
  itemId: string,
): Promise<string | null> {
  const item = await prisma.galleryItem.findFirst({
    where: { id: itemId, userId, kind: "photo" },
  });
  if (!item) return null;
  const meta = parseGalleryMeta(item.metaJson);
  const tid =
    (meta as { templateId?: string }).templateId ||
    (meta as { sourceTemplateId?: string }).sourceTemplateId ||
    "";
  return tid || null;
}

export async function sendFunnelV2AnimatePicker(opts: {
  chatId: number;
  userId: string;
  locale: TgLocale;
  galleryItemId: string;
}) {
  const item = await prisma.galleryItem.findFirst({
    where: { id: opts.galleryItemId, userId: opts.userId, kind: "photo" },
  });
  if (!item) {
    await tgSendMessage(opts.chatId, "Фото не найдено.");
    return;
  }

  const templateId = await resolveTemplateIdForItem(
    opts.userId,
    opts.galleryItemId,
  );
  let cfg = parsePhotoAnimateConfig("");
  if (templateId) {
    const tpl = await prisma.photoTemplate.findUnique({
      where: { id: templateId },
    });
    if (tpl) cfg = parsePhotoAnimateConfig(tpl.animateJson);
  }

  const lines = ANIMATE_DURATIONS_SEC.map((sec) => {
    const price = videoPeachesForSec("animate", sec);
    return `● ${sec} сек = ${priceLine(price)}`;
  });

  const text =
    `<b>Стоимость оживления этой фотографии:</b>\n\n` + lines.join("\n\n");

  const rows: Array<Array<Record<string, unknown>>> = [
    [
      {
        text: "4 секунды",
        callback_data: `fv2:ph:anok:${opts.galleryItemId}:4`,
      },
      {
        text: "7 секунд",
        callback_data: `fv2:ph:anok:${opts.galleryItemId}:7`,
      },
    ],
    [
      {
        text: "12 секунд",
        callback_data: `fv2:ph:anok:${opts.galleryItemId}:12`,
      },
    ],
    [{ text: "⬅️ Вернуться в главное меню", callback_data: FV2.hub }],
  ];

  const markup = { inline_keyboard: rows };
  const stillUrl = (item.resultUrl || "").trim();
  const platformUserId = String(opts.chatId);
  await funnelV2ReplaceUi(platformUserId, opts.chatId, async () => {
    // Show the generated still that will be animated — not the template teaser.
    if (stillUrl && stillUrl !== GALLERY_PLACEHOLDER_URL) {
      try {
        const { tgDeliverPhoto } = await import("@/lib/tg/deliver-media");
        return await tgDeliverPhoto({
          chatId: opts.chatId,
          url: stillUrl,
          caption: text,
          extra: { reply_markup: markup },
        });
      } catch {
        /* fall through */
      }
      try {
        const { tgSendPhoto } = await import("@/lib/tg/telegram-api");
        return (await tgSendPhoto(
          opts.chatId,
          stillUrl.startsWith("http") ? stillUrl : tgAbsoluteUrl(stillUrl),
          text,
          { reply_markup: markup },
        )) as { message_id?: number };
      } catch {
        /* fall through */
      }
    }
    return sendCoverPhoto(opts.chatId, "animate", text, markup);
  });
  void cfg;
  void opts.locale;
}

export async function startFunnelV2Animate(opts: {
  chatId: number;
  userId: string;
  platformUserId: string;
  locale: TgLocale;
  galleryItemId: string;
  durationSec: number;
}) {
  const sec = opts.durationSec;
  if (![4, 7, 12].includes(sec)) {
    await tgSendMessage(opts.chatId, "Выбери 4, 7 или 12 секунд.");
    return;
  }

  const user = await prisma.user.findUnique({ where: { id: opts.userId } });
  if (!user) return;
  const price = videoPeachesForSec("animate", sec);
  const bal = await getFunnelBalance(user);
  if (bal < price) {
    await funnelV2ReplaceUi(opts.platformUserId, opts.chatId, () =>
      tgSendMessage(
        opts.chatId,
        "Сейчас я не могу сгенерировать для тебя, пока ты не пополнишь баланс.",
        {
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: "Пополнить баланс 🍑",
                  callback_data: FV2.topup,
                  style: "success",
                },
              ],
              [{ text: "⬅️ Главное меню", callback_data: FV2.hub }],
            ],
          },
        },
      ),
    );
    return;
  }

  const templateId = await resolveTemplateIdForItem(
    opts.userId,
    opts.galleryItemId,
  );
  let prompt = "gentle camera move, natural motion, cinematic";
  if (templateId) {
    const tpl = await prisma.photoTemplate.findUnique({
      where: { id: templateId },
    });
    if (tpl) {
      const cfg = parsePhotoAnimateConfig(tpl.animateJson);
      const hit = animatePromptForDuration(cfg, sec);
      if (hit) prompt = hit;
    }
  }

  const deb = await debitFunnelBalance(opts.userId, price);
  if (!deb.ok) {
    await tgSendMessage(opts.chatId, "Недостаточно персиков.");
    return;
  }

  await funnelV2ReplaceUi(opts.platformUserId, opts.chatId, () =>
    tgSendMessage(
      opts.chatId,
      "⏳ <b>Оу, сейчас я буду творить!</b>\n\nМне нужно немного времени, скоро отправлю видео",
    ),
  );

  try {
    const { item } = await enqueuePhotoEditAnimatePreview({
      userId: opts.userId,
      stillItemId: opts.galleryItemId,
      templateId: templateId || undefined,
      i2vPrompt: prompt,
      durationSec: sec,
    });

    await prisma.galleryItem.update({
      where: { id: item.id },
      data: {
        metaJson: JSON.stringify({
          ...JSON.parse(
            (
              await prisma.galleryItem.findUnique({ where: { id: item.id } })
            )?.metaJson || "{}",
          ),
          source: "funnel_v2",
          funnelV2: true,
          successKind: "funnel_v2_video",
        }),
      },
    });
    const { watchFunnelV2Delivery } = await import(
      "@/lib/tg/funnel-v2/watch-delivery"
    );
    watchFunnelV2Delivery({
      galleryItemId: item.id,
      userId: opts.userId,
      platformUserId: opts.platformUserId,
      locale: opts.locale,
      kind: "video",
      successKind: "funnel_v2_video",
    });
  } catch (e) {
    const { creditFunnelBalance } = await import("@/lib/tg/funnel-v2/mode");
    await creditFunnelBalance(opts.userId, price).catch(() => undefined);
    const msg = e instanceof Error ? e.message : String(e);
    await tgSendMessage(opts.chatId, `Не удалось запустить оживление: ${msg}`);
  }
}

export async function sendFunnelV2EditPrompt(opts: {
  chatId: number;
  userId: string;
  platformUserId: string;
  locale: TgLocale;
  galleryItemId: string;
}) {
  const price = videoPeachesForSec("animate", 4); // floor option for UI hints
  const { undressPeaches } = await import("@/lib/tg-pricing");
  const editPrice = undressPeaches();

  await setTgSession(opts.platformUserId, {
    chatState: "funnel_v2_awaiting_edit",
    pending: { funnelV2EditItemId: opts.galleryItemId },
  });

  const text =
    `Хочешь добавить что-то своё на её теле? Татуировку, изменить волосы, увеличить/уменьшить размер груди? Да что угодно, без проблем!\n\n` +
    `Просто отправь своими словами в 1 сообщении, что нужно добавить на сделанную фотографию и PeachBitch сделает это\n\n` +
    `Стоимость: ${priceLine(editPrice)}\n\n` +
    `<a href="${tgAbsoluteUrl("/tg/guide")}">🔗 Инструкция, как редактировать и правила</a>`;

  await funnelV2ReplaceUi(opts.platformUserId, opts.chatId, () =>
    sendCoverPhoto(opts.chatId, "editDemo", text, {
      inline_keyboard: [
        [{ text: "⬅️ Вернуться в главное меню", callback_data: FV2.hub }],
      ],
    }),
  );
  void price;
  void opts.userId;
  void opts.locale;
}

export async function handleFunnelV2EditText(opts: {
  chatId: number;
  userId: string;
  platformUserId: string;
  locale: TgLocale;
  text: string;
  galleryItemId: string;
}) {
  const user = await prisma.user.findUnique({ where: { id: opts.userId } });
  if (!user) return;
  const { undressPeaches } = await import("@/lib/tg-pricing");
  const price = undressPeaches();
  const bal = await getFunnelBalance(user);
  if (bal < price) {
    await setTgSession(opts.platformUserId, {
      chatState: "idle",
      clearPending: true,
    });
    await funnelV2ReplaceUi(opts.platformUserId, opts.chatId, () =>
      tgSendMessage(
        opts.chatId,
        "Сейчас я не могу сгенерировать фото для тебя, пока ты не пополнишь баланс.",
        {
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: "Пополнить баланс 🍑",
                  callback_data: FV2.topup,
                  style: "success",
                },
              ],
              [{ text: "⬅️ Главное меню", callback_data: FV2.hub }],
            ],
          },
        },
      ),
    );
    return;
  }

  const still = await prisma.galleryItem.findFirst({
    where: { id: opts.galleryItemId, userId: opts.userId, kind: "photo" },
  });
  if (!still?.resultUrl) {
    await tgSendMessage(opts.chatId, "Исходное фото не найдено.");
    return;
  }

  const deb = await debitFunnelBalance(opts.userId, price);
  if (!deb.ok) {
    await tgSendMessage(opts.chatId, "Недостаточно персиков.");
    return;
  }

  await setTgSession(opts.platformUserId, {
    chatState: "idle",
    clearPending: true,
  });
  await funnelV2ReplaceUi(opts.platformUserId, opts.chatId, () =>
    tgSendMessage(
      opts.chatId,
      "⏳ <b>Оу, сейчас я буду творить!</b>\n\nМне нужно немного времени, скоро отправлю фото",
    ),
  );

  const { localBytesFromResultUrl } = await import("@/lib/peach-lab");
  const { runPhotoEditLabBytes } = await import("@/lib/photo-edit-lab");
  const { enqueueGpuJob } = await import("@/lib/gallery-jobs");
  const { GALLERY_PLACEHOLDER_URL } = await import("@/lib/gallery-meta");
  const { saveGalleryBinary } = await import("@/lib/local-store");
  const { enqueueTgOutbox } = await import("@/lib/tg/session");

  let bytes = localBytesFromResultUrl(still.resultUrl);
  if (!bytes?.length) {
    const { tgAbsoluteUrl } = await import("@/lib/tg/media-assets");
    const abs = still.resultUrl.startsWith("http")
      ? still.resultUrl
      : tgAbsoluteUrl(still.resultUrl);
    const res = await fetch(abs);
    bytes = Buffer.from(await res.arrayBuffer());
  }

  const item = await prisma.galleryItem.create({
    data: {
      userId: opts.userId,
      kind: "photo",
      title: "Редактирование",
      prompt: opts.text.slice(0, 500),
      resultUrl: GALLERY_PLACEHOLDER_URL,
      metaJson: JSON.stringify({
        status: "pending",
        source: "funnel_v2",
        funnelV2: true,
        editOfId: still.id,
      }),
    },
  });

  const chatId = opts.chatId;
  const platformUserId = opts.platformUserId;
  const locale = opts.locale;
  const editText = opts.text;

  void enqueueGpuJob(async () => {
    try {
      // Translate-ish: keep user text; Comfy prompt often accepts RU mixed — prepend instruction.
      const editPrompt = `Edit the photo as requested: ${editText}`;
      const out = await runPhotoEditLabBytes({
        photoBytes: bytes!,
        editPrompt,
      });
      const saved = saveGalleryBinary(opts.userId, "png", out, "fv2_edit");
      await prisma.galleryItem.update({
        where: { id: item.id },
        data: {
          resultUrl: saved.publicUrl,
          metaJson: JSON.stringify({
            status: "ready",
            source: "funnel_v2",
            funnelV2: true,
            editOfId: still.id,
          }),
        },
      });
      await enqueueTgOutbox({
        userId: opts.userId,
        platformUserId,
        kind: "photo",
        payload: {
          url: saved.publicUrl,
          caption: "",
          successKind: "funnel_v2_photo",
          galleryItemId: item.id,
          locale,
          funnelV2: true,
        },
      });
    } catch (e) {
      const { creditFunnelBalance } = await import("@/lib/tg/funnel-v2/mode");
      await creditFunnelBalance(opts.userId, price).catch(() => undefined);
      const msg = e instanceof Error ? e.message : String(e);
      await prisma.galleryItem.update({
        where: { id: item.id },
        data: {
          metaJson: JSON.stringify({ status: "error", error: msg }),
        },
      });
      await tgSendMessage(chatId, `Ошибка редактирования: ${msg}`).catch(
        () => undefined,
      );
    }
  });
}
