/**
 * Funnel v2 — горячее видео по 1 фото (QuickVideo/Story H3 + LoraI2v as I2V from still).
 */
import { prisma } from "@/lib/db";
import type { TgLocale } from "@/lib/tg/i18n";
import { peachesToUsdt } from "@/lib/tg-pricing";
import { tgAbsoluteUrl } from "@/lib/tg/media-assets";
import {
  tgAnswerCallbackQuery,
  tgSendMessage,
  tgSendPhoto,
  tgSendVideo,
} from "@/lib/tg/telegram-api";
import { getTgSession, parsePending, setTgSession } from "@/lib/tg/session";
import { FV2 } from "@/lib/tg/funnel-v2/callbacks";
import {
  debitFunnelBalance,
  getFunnelBalance,
} from "@/lib/tg/funnel-v2/mode";
import { sendCoverPhoto } from "@/lib/tg/funnel-v2/media";
import { videoFunnelCategoryEmojis } from "@/lib/photo-template-animate";
import {
  createVideoRefCharacter,
  addCharacterPhotoFromBuffer,
} from "@/lib/tg/character-service";
import { saveGalleryBinary } from "@/lib/local-store";

const PAGE_SIZE = 6;

type VidRow = {
  id: string;
  title: string;
  kind: "qv" | "li2v";
  price: number;
  notes: string;
  previewImageUrl: string;
  previewVideoUrl: string;
  durationSec: number;
  emojis: string;
};

async function activePhotoUrl(platformUserId: string): Promise<string | null> {
  const s = await getTgSession(platformUserId);
  const p = parsePending(s?.pendingJson || "{}") as {
    funnelV2PhotoUrl?: string;
  };
  return p.funnelV2PhotoUrl?.trim() || null;
}

async function listVideoRows(userId: string, locale: TgLocale): Promise<VidRow[]> {
  const [qv, li2v] = await Promise.all([
    prisma.quickVideoTemplate.findMany({
      where: { tgPublished: true },
      orderBy: [{ tgSortOrder: "asc" }, { updatedAt: "desc" }],
      take: 40,
    }),
    prisma.loraI2vTemplate.findMany({
      where: { tgPublished: true },
      orderBy: [{ tgSortOrder: "asc" }, { updatedAt: "desc" }],
      take: 40,
    }),
  ]);

  const { priceForQuickVideoTemplate, priceForLoraI2vTemplate } = await import(
    "@/lib/template-pricing"
  );

  const rows: VidRow[] = [
    ...qv.map((r) => ({
      id: r.id,
      title: (r.tgDisplayTitle || (locale === "en" ? r.titleEn || r.title : r.title)).trim(),
      kind: "qv" as const,
      price: priceForQuickVideoTemplate({
        shotsJson: r.shotsJson,
        durationSec: r.durationSec,
      }),
      notes: (locale === "en" ? r.notesEn || r.notes : r.notes) || "",
      previewImageUrl: r.previewPhotoUrl || "",
      previewVideoUrl: r.previewVideoUrl || "",
      durationSec: r.durationSec || 6,
      emojis: videoFunnelCategoryEmojis(r.sceneCategory),
    })),
    ...li2v.map((r) => ({
      id: r.id,
      title: (r.tgDisplayTitle || (locale === "en" ? r.titleEn || r.title : r.title)).trim(),
      kind: "li2v" as const,
      price: priceForLoraI2vTemplate(r.durationSec || 6, {
        shotsJson: r.shotsJson || "",
      }),
      notes: (locale === "en" ? r.notesEn || r.notes : r.notes) || "",
      previewImageUrl: r.previewImageUrl || "",
      previewVideoUrl: r.previewVideoUrl || "",
      durationSec: r.durationSec || 6,
      emojis: videoFunnelCategoryEmojis(r.sceneCategory),
    })),
  ];
  void userId;
  return rows;
}

function priceLine(peaches: number): string {
  return `${peaches}🍑 (${peaches} рублей / ${peachesToUsdt(peaches)}$)`;
}

export async function sendFunnelV2VideoHub(
  chatId: number,
  userId: string,
  platformUserId: string,
  locale: TgLocale,
  page = 0,
) {
  const photoUrl = await activePhotoUrl(platformUserId);
  const tpls = await listVideoRows(userId, locale);
  const pages = Math.max(1, Math.ceil(tpls.length / PAGE_SIZE));
  const p = Math.min(Math.max(0, page), pages - 1);
  const slice = tpls.slice(p * PAGE_SIZE, p * PAGE_SIZE + PAGE_SIZE);

  const header = photoUrl
    ? "<b>Фотография загружена</b>, но ты можешь заменить её на другую"
    : "<b>Фотография пока не загружена</b>";
  const body =
    `${header}\n` +
    `Здесь тебе доступны шаблоны обычного секса 🍓, сюжетные🍿, с диалогами 💬\n` +
    `Выбирай то, что тебе хочется с ней сделать 😜`;

  const rows: Array<Array<Record<string, unknown>>> = [];
  for (let i = 0; i < slice.length; i += 2) {
    const a = slice[i]!;
    const b = slice[i + 1];
    const label = (t: VidRow) =>
      `${t.title.slice(0, 28)}${t.emojis}`.slice(0, 40);
    const row = [
      {
        text: label(a),
        callback_data: `fv2:vid:t:${a.kind}:${a.id}`,
      },
    ];
    if (b) {
      row.push({
        text: label(b),
        callback_data: `fv2:vid:t:${b.kind}:${b.id}`,
      });
    }
    rows.push(row);
  }
  if (pages > 1) {
    const nav: Array<Record<string, unknown>> = [];
    if (p > 0) nav.push({ text: "⬅️", callback_data: `fv2:vid:p:${p - 1}` });
    if (p < pages - 1) {
      nav.push({ text: "Ещё шаблоны➡️", callback_data: `fv2:vid:p:${p + 1}` });
    }
    if (nav.length) rows.push(nav);
  }
  if (photoUrl) {
    rows.push([
      {
        text: "Сменить фото",
        callback_data: "fv2:vid:chg",
        style: "danger",
      },
    ]);
  }
  rows.push([
    { text: "⬅️ Вернуться в главное меню", callback_data: FV2.hub },
  ]);

  try {
    if (photoUrl) {
      await tgSendPhoto(
        chatId,
        photoUrl.startsWith("http") ? photoUrl : tgAbsoluteUrl(photoUrl),
        body,
        { reply_markup: { inline_keyboard: rows } },
      );
    } else {
      await sendCoverPhoto(chatId, "videoPlaceholder", body, {
        inline_keyboard: rows,
      });
    }
  } catch {
    await tgSendMessage(chatId, body, {
      reply_markup: { inline_keyboard: rows },
    });
  }
}

async function sendVideoConfirm(
  chatId: number,
  row: VidRow,
) {
  const text =
    `🎥 <b>${row.title}${row.emojis}</b>\n` +
    `${row.notes ? row.notes.slice(0, 400) + "\n" : ""}` +
    `Стоимость: ${priceLine(row.price)}\n` +
    `<a href="${tgAbsoluteUrl("/tg/guide")}">🔗 Инструкция, как использовать шаблон и примеры</a>`;
  const kb = {
    inline_keyboard: [
      [
        { text: "Отменить", callback_data: "fv2:vid:x", style: "danger" },
        {
          text: "Подтвердить✔️",
          callback_data: `fv2:vid:ok:${row.kind}:${row.id}`,
          style: "success",
        },
      ],
    ],
  };
  try {
    if (row.previewVideoUrl) {
      const u = row.previewVideoUrl.startsWith("http")
        ? row.previewVideoUrl
        : tgAbsoluteUrl(row.previewVideoUrl);
      await tgSendVideo(chatId, u, text, { reply_markup: kb });
      return;
    }
    if (row.previewImageUrl) {
      const u = row.previewImageUrl.startsWith("http")
        ? row.previewImageUrl
        : tgAbsoluteUrl(row.previewImageUrl);
      await tgSendPhoto(chatId, u, text, { reply_markup: kb });
      return;
    }
  } catch {
    /* fall through */
  }
  await tgSendMessage(chatId, text, { reply_markup: kb });
}

async function loadPhotoBytes(photoUrl: string): Promise<Buffer> {
  const { localBytesFromResultUrl } = await import("@/lib/peach-lab");
  const local = localBytesFromResultUrl(photoUrl);
  if (local?.length) return local;
  const abs = photoUrl.startsWith("http") ? photoUrl : tgAbsoluteUrl(photoUrl);
  const res = await fetch(abs);
  if (!res.ok) throw new Error("photo fetch failed");
  return Buffer.from(await res.arrayBuffer());
}

async function ensureFunnelVideoRefCharacter(
  userId: string,
  photoBytes: Buffer,
): Promise<string> {
  const existing = await prisma.character.findFirst({
    where: {
      userId,
      videoRefOnly: true,
      name: { startsWith: "FV2" },
    },
    orderBy: { updatedAt: "desc" },
  });
  const ch =
    existing ||
    (await createVideoRefCharacter(userId, "FV2 ref"));
  // Reset photos: add latest as only ref
  await addCharacterPhotoFromBuffer(
    userId,
    ch.id,
    photoBytes,
    `fv2_${Date.now()}.jpg`,
    { maxPhotos: 8, skipAgeGate: true },
  );
  return ch.id;
}

async function runFunnelV2VideoGen(opts: {
  chatId: number;
  userId: string;
  platformUserId: string;
  locale: TgLocale;
  kind: "qv" | "li2v";
  templateId: string;
  photoUrl: string;
}) {
  const user = await prisma.user.findUnique({ where: { id: opts.userId } });
  if (!user) return;

  const rows = await listVideoRows(opts.userId, opts.locale);
  const row = rows.find((r) => r.id === opts.templateId && r.kind === opts.kind);
  if (!row) {
    await tgSendMessage(opts.chatId, "Шаблон не найден.");
    return;
  }

  const bal = await getFunnelBalance(user);
  if (bal < row.price) {
    await sendCoverPhoto(
      opts.chatId,
      "needTopup",
      "Сейчас я не могу сгенерировать видео для тебя, пока ты не пополнишь баланс. " +
        "Сейчас тебя ждёт много бонусных 🍑 за пополнение баланса.",
      {
        inline_keyboard: [
          [
            {
              text: "Пополнить баланс 🍑",
              callback_data: FV2.topup,
              style: "success",
            },
          ],
          [{ text: "⬅️ Вернуться в главное меню", callback_data: FV2.hub }],
        ],
      },
    );
    return;
  }

  const deb = await debitFunnelBalance(opts.userId, row.price);
  if (!deb.ok) {
    await tgSendMessage(opts.chatId, "Недостаточно персиков.");
    return;
  }

  await tgSendMessage(
    opts.chatId,
    "⏳ <b>Оу, сейчас я буду творить!</b>\nМне нужно немного времени, скоро отправлю видео",
  );

  try {
    const bytes = await loadPhotoBytes(opts.photoUrl);

    if (opts.kind === "li2v") {
      // One-photo I2V: use uploaded still + template i2v prompt (no LoRA).
      const tpl = await prisma.loraI2vTemplate.findFirst({
        where: { id: opts.templateId, tgPublished: true },
      });
      if (!tpl) throw new Error("Шаблон не найден");
      const stillSaved = saveGalleryBinary(
        opts.userId,
        "jpg",
        bytes,
        "fv2_vid_still",
      );
      const stillItem = await prisma.galleryItem.create({
        data: {
          userId: opts.userId,
          kind: "photo",
          title: "FV2 video still",
          prompt: tpl.stillPrompt || "still",
          resultUrl: stillSaved.publicUrl,
          metaJson: JSON.stringify({
            status: "ready",
            source: "funnel_v2",
          }),
        },
      });
      const { enqueueAnimateJob } = await import("@/lib/gallery-jobs");
      const item = await enqueueAnimateJob(
        opts.userId,
        stillItem.id,
        tpl.i2vPrompt || "cinematic motion",
        false,
        tpl.i2vPrompt || undefined,
        tpl.durationSec || 6,
      );
      await prisma.galleryItem.update({
        where: { id: item.id },
        data: {
          title: tpl.tgDisplayTitle || tpl.title,
          metaJson: JSON.stringify({
            ...JSON.parse(
              (
                await prisma.galleryItem.findUnique({ where: { id: item.id } })
              )?.metaJson || "{}",
            ),
            source: "funnel_v2",
            funnelV2: true,
            successKind: "funnel_v2_video",
            chargedPeaches: row.price,
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
      return;
    }

    // Story H3 / QuickVideo via video-ref character
    const characterId = await ensureFunnelVideoRefCharacter(
      opts.userId,
      bytes,
    );
    // Bridge: credit real wallet so existing service can debit, then it nets zero for preview.
    // For preview wallet we already debited funnel balance — credit peaches then let service debit.
    const { creditPeaches } = await import("@/lib/tg/wallet");
    await creditPeaches(opts.userId, row.price, "funnel_v2_video_bridge", {
      templateId: opts.templateId,
    });
    const { startTgVideoGeneration } = await import(
      "@/lib/tg/generation-service"
    );
    const result = await startTgVideoGeneration({
      userId: opts.userId,
      platformUserId: opts.platformUserId,
      templateId: opts.templateId,
      characterId,
    });
    if (result?.galleryItemId) {
      const gi = await prisma.galleryItem.findUnique({
        where: { id: result.galleryItemId },
      });
      if (gi) {
        const meta = JSON.parse(gi.metaJson || "{}") as Record<string, unknown>;
        meta.source = "funnel_v2";
        meta.funnelV2 = true;
        meta.successKind = "funnel_v2_video";
        await prisma.galleryItem.update({
          where: { id: gi.id },
          data: { metaJson: JSON.stringify(meta) },
        });
      }
    }
  } catch (e) {
    const { creditFunnelBalance } = await import("@/lib/tg/funnel-v2/mode");
    await creditFunnelBalance(opts.userId, row.price).catch(() => undefined);
    const msg = e instanceof Error ? e.message : String(e);
    await tgSendMessage(opts.chatId, `Не удалось запустить видео: ${msg}`);
  }
}

export async function handleFunnelV2VideoCallback(opts: {
  chatId: number;
  userId: string;
  platformUserId: string;
  locale: TgLocale;
  data: string;
  callbackId?: string;
}): Promise<boolean> {
  const { chatId, userId, platformUserId, locale, data } = opts;

  if (data === FV2.video || data === "fv2:vid:x") {
    await sendFunnelV2VideoHub(chatId, userId, platformUserId, locale, 0);
    return true;
  }
  if (data === "fv2:vid:chg") {
    await setTgSession(platformUserId, {
      chatState: "funnel_v2_awaiting_photo",
      pending: { funnelV2AwaitReplace: true, funnelV2ReturnTo: "video" },
    });
    await tgSendMessage(
      chatId,
      "Пришли новое фото одним сообщением (файл или сжатое фото).",
    );
    return true;
  }
  const pageM = /^fv2:vid:p:(\d+)$/.exec(data);
  if (pageM) {
    await sendFunnelV2VideoHub(
      chatId,
      userId,
      platformUserId,
      locale,
      Number(pageM[1]),
    );
    return true;
  }
  const pickM = /^fv2:vid:t:(qv|li2v):(.+)$/.exec(data);
  if (pickM) {
    const kind = pickM[1] as "qv" | "li2v";
    const id = pickM[2]!;
    const rows = await listVideoRows(userId, locale);
    const row = rows.find((r) => r.id === id && r.kind === kind);
    if (!row) {
      if (opts.callbackId) {
        await tgAnswerCallbackQuery(opts.callbackId, "Шаблон не найден");
      }
      return true;
    }
    await sendVideoConfirm(chatId, row);
    return true;
  }
  const okM = /^fv2:vid:ok:(qv|li2v):(.+)$/.exec(data);
  if (okM) {
    const kind = okM[1] as "qv" | "li2v";
    const id = okM[2]!;
    const photoUrl = await activePhotoUrl(platformUserId);
    if (!photoUrl) {
      if (opts.callbackId) {
        await tgAnswerCallbackQuery(
          opts.callbackId,
          "Нужно фото, потом Подтвердить",
        );
      }
      await setTgSession(platformUserId, {
        chatState: "funnel_v2_awaiting_photo",
        pending: {
          funnelV2PendingVideoConfirm: { kind, id },
        },
      });
      await tgSendMessage(
        chatId,
        "Сначала пришли фото одним сообщением, потом снова нажми Подтвердить.",
      );
      return true;
    }
    await runFunnelV2VideoGen({
      chatId,
      userId,
      platformUserId,
      locale,
      kind,
      templateId: id,
      photoUrl,
    });
    return true;
  }
  return false;
}

export async function resumeFunnelV2VideoAfterPhoto(opts: {
  chatId: number;
  userId: string;
  platformUserId: string;
  locale: TgLocale;
  photoUrl: string;
  pending: { kind: "qv" | "li2v"; id: string };
}) {
  await runFunnelV2VideoGen({
    chatId: opts.chatId,
    userId: opts.userId,
    platformUserId: opts.platformUserId,
    locale: opts.locale,
    kind: opts.pending.kind,
    templateId: opts.pending.id,
    photoUrl: opts.photoUrl,
  });
}
