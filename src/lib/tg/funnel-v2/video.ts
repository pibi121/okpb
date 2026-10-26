/**
 * Funnel v2 — видео по 1 фото; dual-cast QuickVideo (identityPersonCount≥2)
 * optionally accepts a second hero photo (else baked partner from template).
 */
import { prisma } from "@/lib/db";
import type { TgLocale } from "@/lib/tg/i18n";
import { formatRubOnly } from "@/lib/tg/funnel-v2/money";
import { tgAbsoluteUrl } from "@/lib/tg/media-assets";
import {
  tgAnswerCallbackQuery,
  tgSendMessage,
  tgSendPhoto,
  tgSendPhotoFile,
  tgSendVideo,
} from "@/lib/tg/telegram-api";
import { getTgSession, parsePending, setTgSession } from "@/lib/tg/session";
import { userFacingFailure } from "@/lib/tg/user-facing-error";
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
import { funnelV2ReplaceUi } from "@/lib/tg/funnel-v2/ui";
import {
  groupKeyboardRows,
  paginateKeyboardRows,
  parseTgButtonStyle,
  tgInlineButton,
  type TgButtonStyle,
} from "@/lib/tg/funnel-v2/keyboard-layout";
import { loadFunnelKeyboardSettings } from "@/lib/tg/funnel-v2/keyboard-settings";

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
  rowBreak: boolean;
  buttonStyle: TgButtonStyle;
  identityPersonCount: number;
  hasBakedPartner: boolean;
};

function blueprintHasBakedPartner(slotBlueprintJson: string): boolean {
  try {
    const j = JSON.parse(slotBlueprintJson || "[]") as Array<{
      role?: string;
      pictureIndex?: number;
      bakedRefUrl?: string;
    }>;
    if (!Array.isArray(j)) return false;
    return j.some(
      (s) =>
        s?.role === "identity" &&
        (s.pictureIndex || 0) >= 2 &&
        !!s.bakedRefUrl?.trim(),
    );
  } catch {
    return false;
  }
}

async function activePhotoUrl(platformUserId: string): Promise<string | null> {
  const s = await getTgSession(platformUserId);
  const p = parsePending(s?.pendingJson || "{}") as {
    funnelV2PhotoUrl?: string;
  };
  return p.funnelV2PhotoUrl?.trim() || null;
}

async function activePhoto2Url(platformUserId: string): Promise<string | null> {
  const s = await getTgSession(platformUserId);
  const p = parsePending(s?.pendingJson || "{}") as {
    funnelV2Photo2Url?: string;
  };
  return p.funnelV2Photo2Url?.trim() || null;
}

function isDualCast(row: VidRow): boolean {
  return row.kind === "qv" && row.identityPersonCount >= 2;
}

async function sendFunnelRefPhoto(
  chatId: number,
  platformUserId: string,
  caption: string,
  reply_markup: Record<string, unknown>,
): Promise<{ message_id?: number } | undefined> {
  const s = await getTgSession(platformUserId);
  const p = parsePending(s?.pendingJson || "{}") as {
    funnelV2PhotoUrl?: string;
    funnelV2PhotoKey?: string;
  };
  let bytes: Buffer | null = null;
  if (p.funnelV2PhotoKey) {
    const { resolveGalleryFile } = await import("@/lib/local-store");
    const abs = resolveGalleryFile(p.funnelV2PhotoKey);
    if (abs) {
      const fs = await import("fs");
      if (fs.existsSync(abs)) bytes = fs.readFileSync(abs);
    }
  }
  if (!bytes?.length && p.funnelV2PhotoUrl) {
    try {
      bytes = await loadPhotoBytes(p.funnelV2PhotoUrl);
    } catch {
      bytes = null;
    }
  }
  if (bytes?.length) {
    return (await tgSendPhotoFile(chatId, bytes, "ref.jpg", caption, {
      reply_markup,
    })) as { message_id?: number };
  }
  if (p.funnelV2PhotoUrl) {
    const url = p.funnelV2PhotoUrl.startsWith("http")
      ? p.funnelV2PhotoUrl
      : tgAbsoluteUrl(p.funnelV2PhotoUrl);
    return (await tgSendPhoto(chatId, url, caption, {
      reply_markup,
    })) as { message_id?: number };
  }
  return undefined;
}

async function listVideoRows(userId: string, locale: TgLocale): Promise<VidRow[]> {
  const [qv, li2v] = await Promise.all([
    prisma.quickVideoTemplate.findMany({
      where: { funnelV2Published: true },
      orderBy: [{ tgSortOrder: "asc" }, { updatedAt: "desc" }],
      take: 120,
    }),
    prisma.loraI2vTemplate.findMany({
      // Funnel v2 bot: only one-photo I2V (no LoRA character)
      where: { funnelV2Published: true, requiresLora: false },
      orderBy: [{ tgSortOrder: "asc" }, { updatedAt: "desc" }],
      take: 120,
    }),
  ]);

  const { priceForQuickVideoTemplate, priceForLoraI2vTemplate } = await import(
    "@/lib/template-pricing"
  );

  const rows: VidRow[] = [
    ...qv.map((r) => {
      const identityPersonCount = Math.max(1, r.identityPersonCount || 1);
      return {
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
        rowBreak: r.tgRowBreak,
        buttonStyle: parseTgButtonStyle(r.tgButtonStyle),
        identityPersonCount,
        hasBakedPartner:
          identityPersonCount >= 2 &&
          blueprintHasBakedPartner(r.slotBlueprintJson || ""),
      };
    }),
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
      rowBreak: r.tgRowBreak,
      buttonStyle: parseTgButtonStyle(r.tgButtonStyle),
      identityPersonCount: 1,
      hasBakedPartner: false,
    })),
  ];
  void userId;
  return rows;
}

function priceLine(peaches: number): string {
  return formatRubOnly(peaches);
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
  const keyboard = await loadFunnelKeyboardSettings();
  const grouped = groupKeyboardRows(tpls, keyboard.video.customRows);
  const paged = paginateKeyboardRows(
    grouped,
    page,
    keyboard.video.firstPageSize,
    keyboard.video.nextPageSize,
  );
  const p = paged.pageIndex;
  const pages = paged.pageCount;

  const header = photoUrl
    ? ""
    : "<b>Фотография пока не загружена</b>\n\n";
  const body =
    `${header}` +
    `Здесь тебе доступны шаблоны обычного секса 🍓, сюжетные🍿, с диалогами 💬\n\n` +
    `Выбирай то, что тебе хочется с ней сделать 😜`;

  const rows: Array<Array<Record<string, unknown>>> = [];
  const label = (t: VidRow) =>
    `${t.title.slice(0, 28)}${t.emojis}`.slice(0, 40);
  for (const rowItems of paged.pageRows) {
    rows.push(
      rowItems.map((tpl) =>
        tgInlineButton(
          label(tpl),
          `fv2:vid:t:${tpl.kind}:${tpl.id}`,
          tpl.buttonStyle,
        ),
      ),
    );
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

  const markup = { inline_keyboard: rows };
  await funnelV2ReplaceUi(platformUserId, chatId, async () => {
    try {
      if (photoUrl) {
        const sent = await sendFunnelRefPhoto(
          chatId,
          platformUserId,
          body,
          markup,
        );
        if (sent) return sent;
      }
      return sendCoverPhoto(chatId, "videoPlaceholder", body, markup);
    } catch {
      return (await tgSendMessage(chatId, body, {
        reply_markup: markup,
      })) as { message_id?: number };
    }
  });
}

async function sendVideoConfirm(
  chatId: number,
  platformUserId: string,
  row: VidRow,
) {
  const notesBlock = row.notes ? `${row.notes.slice(0, 400)}\n\n` : "";
  const dual = isDualCast(row);
  const photo1 = await activePhotoUrl(platformUserId);
  const photo2 = dual ? await activePhoto2Url(platformUserId) : null;

  let castBlock = "";
  if (dual) {
    const p1 = photo1 ? "✅ своё фото" : "❌ ещё нет — пришли фото";
    const p2 = photo2
      ? "✅ твоё фото"
      : row.hasBakedPartner
        ? "из шаблона (по умолчанию)"
        : "❌ нет в шаблоне — пришли фото 2-го";
    castBlock =
      `<b>Два героя в сцене</b>\n` +
      `• Девушка (обязательно): ${p1}\n` +
      `• Второй герой (по желанию): ${p2}\n\n`;
  }

  const readyHint = dual
    ? photo1
      ? photo2 || row.hasBakedPartner
        ? `Готово к генерации. Можно добавить своё фото 2-го героя или оставить партнёра из шаблона.\n\n`
        : `Нужно фото второго героя (в этом шаблоне нет партнёра по умолчанию).\n\n`
      : `Сначала пришли фото девушки, потом подтверди.\n\n`
    : `Я готов сделать с ней это видео. Просто нажми «Подтвердить»\n\n`;

  const text =
    `🎥 <b>${row.title}${row.emojis}</b>\n\n` +
    notesBlock +
    castBlock +
    `Стоимость: ${priceLine(row.price)}\n\n` +
    readyHint +
    `<a href="https://telegra.ph/Instrukciya-kak-generirovat-foto-09-26">🔗 Инструкция, как этим пользоваться</a>`;

  const rows: Array<Array<Record<string, unknown>>> = [];
  if (dual) {
    rows.push([
      {
        text: "Сменить фото девушки",
        callback_data: `fv2:vid:chg1:${row.kind}:${row.id}`,
        style: "danger",
      },
    ]);
    rows.push([
      {
        text: photo2 ? "Сменить фото 2-го" : "Добавить фото 2-го",
        callback_data: `fv2:vid:chg2:${row.kind}:${row.id}`,
      },
    ]);
    if (photo2) {
      rows.push([
        {
          text: "Взять 2-го из шаблона",
          callback_data: `fv2:vid:clr2:${row.kind}:${row.id}`,
        },
      ]);
    }
  }
  rows.push([
    { text: "Отменить", callback_data: "fv2:vid:x", style: "danger" },
    {
      text: "Подтвердить✔️",
      callback_data: `fv2:vid:ok:${row.kind}:${row.id}`,
      style: "success",
    },
  ]);
  const kb = { inline_keyboard: rows };

  await funnelV2ReplaceUi(platformUserId, chatId, async () => {
    try {
      if (row.previewVideoUrl) {
        const u = row.previewVideoUrl.startsWith("http")
          ? row.previewVideoUrl
          : tgAbsoluteUrl(row.previewVideoUrl);
        return (await tgSendVideo(chatId, u, text, {
          reply_markup: kb,
        })) as { message_id?: number };
      }
      if (row.previewImageUrl) {
        const u = row.previewImageUrl.startsWith("http")
          ? row.previewImageUrl
          : tgAbsoluteUrl(row.previewImageUrl);
        return (await tgSendPhoto(chatId, u, text, {
          reply_markup: kb,
        })) as { message_id?: number };
      }
    } catch {
      /* fall through */
    }
    return (await tgSendMessage(chatId, text, {
      reply_markup: kb,
    })) as { message_id?: number };
  });
}

/** Re-open confirm after dual-cast photo1/photo2 upload. */
export async function resumeFunnelV2VideoConfirm(opts: {
  chatId: number;
  userId: string;
  platformUserId: string;
  locale: TgLocale;
  pending: { kind: "qv" | "li2v"; id: string };
}) {
  const rows = await listVideoRows(opts.userId, opts.locale);
  const row = rows.find(
    (r) => r.id === opts.pending.id && r.kind === opts.pending.kind,
  );
  if (!row) {
    await tgSendMessage(opts.chatId, "Шаблон не найден.");
    return;
  }
  await sendVideoConfirm(opts.chatId, opts.platformUserId, row);
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
  locale: TgLocale = "ru",
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

  // Always replace ref photos — otherwise QuickVideo keeps mixing the old face.
  const { listCharacterPhotos, deleteCharacterPhoto } = await import(
    "@/lib/character-dataset"
  );
  for (const photo of listCharacterPhotos(ch.id)) {
    try {
      deleteCharacterPhoto(ch.id, photo.name);
    } catch {
      /* ignore */
    }
  }

  await addCharacterPhotoFromBuffer(
    userId,
    ch.id,
    photoBytes,
    `fv2_${Date.now()}.jpg`,
    { maxPhotos: 1, locale },
  );
  await prisma.character.update({
    where: { id: ch.id },
    data: { photoCount: 1, updatedAt: new Date() },
  });
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
  photo2Url?: string | null;
}) {
  const user = await prisma.user.findUnique({ where: { id: opts.userId } });
  if (!user) return;

  const { isVideoFrozen, noteVideoFreezeAttempt, VIDEO_FREEZE_BROADCAST } =
    await import("@/lib/ops/video-freeze");
  if (await isVideoFrozen()) {
    await noteVideoFreezeAttempt(opts.userId);
    await tgSendMessage(opts.chatId, VIDEO_FREEZE_BROADCAST);
    return;
  }

  const rows = await listVideoRows(opts.userId, opts.locale);
  const row = rows.find((r) => r.id === opts.templateId && r.kind === opts.kind);
  if (!row) {
    await tgSendMessage(opts.chatId, "Шаблон не найден.");
    return;
  }

  const bal = await getFunnelBalance(user);
  if (bal < row.price) {
    await funnelV2ReplaceUi(opts.platformUserId, opts.chatId, () =>
      sendCoverPhoto(
        opts.chatId,
        "needTopup",
        "Сейчас я не могу сгенерировать видео для тебя, пока ты не пополнишь баланс.\n\n" +
          "Сейчас тебя ждёт много бонусов за пополнение баланса.",
        {
          inline_keyboard: [
            [
              {
                text: "Пополнить баланс",
                callback_data: FV2.topup,
                style: "success",
              },
            ],
            [{ text: "⬅️ Вернуться в главное меню", callback_data: FV2.hub }],
          ],
        },
      ),
    );
    return;
  }

  const { decideUserVideo } = await import("@/lib/gpu/user-gen-limit");
  const videoGate = await decideUserVideo(opts.userId);
  if (videoGate.action === "reject") {
    await tgSendMessage(opts.chatId, videoGate.message);
    return;
  }

  const deb = await debitFunnelBalance(opts.userId, row.price);
  if (!deb.ok) {
    await tgSendMessage(opts.chatId, "Недостаточно средств на балансе.");
    return;
  }

  await funnelV2ReplaceUi(opts.platformUserId, opts.chatId, () =>
    tgSendMessage(
      opts.chatId,
      "⏳ <b>Оу, сейчас я буду творить!</b>\n\nМне нужно немного времени, скоро отправлю видео",
    ),
  );

  let bridgedPeaches = false;
  try {
    const { trackFunnelEventBg } = await import("@/lib/ops/funnel-track");
    trackFunnelEventBg({
      userId: opts.userId,
      platformUserId: opts.platformUserId,
      eventKey: "bot.fv2.gen_start",
      surface: "bot",
      meta: {
        kind: opts.kind,
        templateId: opts.templateId,
        section: "video",
      },
    });
    const bytes = await loadPhotoBytes(opts.photoUrl);

    if (opts.kind === "li2v") {
      // One-photo I2V: use uploaded still + template i2v prompt (no LoRA).
      const tpl = await prisma.loraI2vTemplate.findFirst({
        where: {
          id: opts.templateId,
          funnelV2Published: true,
          requiresLora: false,
        },
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
      const { decideUserVideo, throwIfRejected, withUserGenLock, tellUserGenText, USER_GEN_TEXT } =
        await import("@/lib/gpu/user-gen-limit");
      const item = await withUserGenLock(opts.userId, async () => {
        const plan = await decideUserVideo(opts.userId);
        throwIfRejected(plan);
        const created = await enqueueAnimateJob(
          opts.userId,
          stillItem.id,
          tpl.i2vPrompt || "cinematic motion",
          false,
          tpl.i2vPrompt || undefined,
          tpl.durationSec || 6,
          { deferGpu: plan.action === "defer" },
        );
        if (plan.action === "defer") {
          await tellUserGenText(opts.userId, USER_GEN_TEXT.videoAfterPhotos);
        } else {
          const { waitForUserGpuJob } = await import("@/lib/gpu/user-gen-limit");
          await waitForUserGpuJob("galleryItem", created.id);
        }
        return created;
      });
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
      opts.locale,
    );
    let secondIdentityBytes: Buffer | null = null;
    if (isDualCast(row) && opts.photo2Url?.trim()) {
      try {
        secondIdentityBytes = await loadPhotoBytes(opts.photo2Url.trim());
      } catch {
        secondIdentityBytes = null;
      }
    }
    // Bridge: credit real wallet so existing service can debit, then it nets zero for preview.
    // For preview wallet we already debited funnel balance — credit peaches then let service debit.
    const { creditPeaches } = await import("@/lib/tg/wallet");
    await creditPeaches(opts.userId, row.price, "funnel_v2_video_bridge", {
      templateId: opts.templateId,
    });
    bridgedPeaches = true;
    const { startTgVideoGeneration } = await import(
      "@/lib/tg/generation-service"
    );
    const result = await startTgVideoGeneration({
      userId: opts.userId,
      platformUserId: opts.platformUserId,
      templateId: opts.templateId,
      characterId,
      secondIdentityBytes,
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
    const { isUserGenLimitError } = await import("@/lib/gpu/user-gen-limit");
    if (isUserGenLimitError(e) && bridgedPeaches) {
      const { debitPeaches } = await import("@/lib/tg/wallet");
      await debitPeaches(opts.userId, row.price, "funnel_v2_video_bridge_undo", {
        templateId: opts.templateId,
      }).catch(() => undefined);
    }
    await creditFunnelBalance(opts.userId, row.price).catch(() => undefined);
    if (isUserGenLimitError(e)) {
      await tgSendMessage(opts.chatId, e.message);
      return;
    }
    await tgSendMessage(
      opts.chatId,
      userFacingFailure(
        e,
        "Не удалось запустить видео. Попробуй ещё раз.",
        "Не удалось запустить видео: ",
      ),
    );
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
      pending: {
        funnelV2AwaitReplace: true,
        funnelV2AwaitPhoto2: false,
        funnelV2ReturnTo: "video",
      },
    });
    await funnelV2ReplaceUi(platformUserId, chatId, () =>
      tgSendMessage(
        chatId,
        "Пришли новое фото одним сообщением (файл или сжатое фото).",
      ),
    );
    return true;
  }
  const chg1M = /^fv2:vid:chg1:(qv|li2v):(.+)$/.exec(data);
  if (chg1M) {
    const kind = chg1M[1] as "qv" | "li2v";
    const id = chg1M[2]!;
    await setTgSession(platformUserId, {
      chatState: "funnel_v2_awaiting_photo",
      pending: {
        funnelV2AwaitReplace: true,
        funnelV2AwaitPhoto2: false,
        funnelV2PendingVideoConfirm: { kind, id },
        funnelV2ReturnTo: "video",
      },
    });
    await funnelV2ReplaceUi(platformUserId, chatId, () =>
      tgSendMessage(
        chatId,
        "Пришли фото девушки одним сообщением (файл или сжатое фото).",
      ),
    );
    return true;
  }
  const chg2M = /^fv2:vid:chg2:(qv|li2v):(.+)$/.exec(data);
  if (chg2M) {
    const kind = chg2M[1] as "qv" | "li2v";
    const id = chg2M[2]!;
    await setTgSession(platformUserId, {
      chatState: "funnel_v2_awaiting_photo",
      pending: {
        funnelV2AwaitPhoto2: true,
        funnelV2AwaitReplace: false,
        funnelV2PendingVideoConfirm: { kind, id },
      },
    });
    await funnelV2ReplaceUi(platformUserId, chatId, () =>
      tgSendMessage(
        chatId,
        "Пришли фото второго героя одним сообщением (файл или сжатое фото).",
      ),
    );
    return true;
  }
  const clr2M = /^fv2:vid:clr2:(qv|li2v):(.+)$/.exec(data);
  if (clr2M) {
    const kind = clr2M[1] as "qv" | "li2v";
    const id = clr2M[2]!;
    await setTgSession(platformUserId, {
      pending: {
        funnelV2Photo2Url: "",
        funnelV2Photo2Key: "",
        funnelV2AwaitPhoto2: false,
        funnelV2PendingVideoConfirm: { kind, id },
      },
    });
    const rows = await listVideoRows(userId, locale);
    const row = rows.find((r) => r.id === id && r.kind === kind);
    if (row) await sendVideoConfirm(chatId, platformUserId, row);
    if (opts.callbackId) {
      await tgAnswerCallbackQuery(opts.callbackId, "2-й герой из шаблона");
    }
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
    await setTgSession(platformUserId, {
      pending: { funnelV2PendingVideoConfirm: { kind, id } },
    });
    await sendVideoConfirm(chatId, platformUserId, row);
    return true;
  }
  const okM = /^fv2:vid:ok:(qv|li2v):(.+)$/.exec(data);
  if (okM) {
    const kind = okM[1] as "qv" | "li2v";
    const id = okM[2]!;
    const rows = await listVideoRows(userId, locale);
    const row = rows.find((r) => r.id === id && r.kind === kind);
    const photoUrl = await activePhotoUrl(platformUserId);
    const photo2Url = await activePhoto2Url(platformUserId);
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
          funnelV2AwaitPhoto2: false,
          funnelV2PendingVideoConfirm: { kind, id },
        },
      });
      await funnelV2ReplaceUi(platformUserId, chatId, () =>
        tgSendMessage(
          chatId,
          row && isDualCast(row)
            ? "Сначала пришли фото девушки одним сообщением, потом снова нажми Подтвердить."
            : "Сначала пришли фото одним сообщением, потом снова нажми Подтвердить.",
        ),
      );
      return true;
    }
    if (row && isDualCast(row) && !photo2Url && !row.hasBakedPartner) {
      if (opts.callbackId) {
        await tgAnswerCallbackQuery(
          opts.callbackId,
          "Нужно фото 2-го героя",
        );
      }
      await setTgSession(platformUserId, {
        chatState: "funnel_v2_awaiting_photo",
        pending: {
          funnelV2AwaitPhoto2: true,
          funnelV2PendingVideoConfirm: { kind, id },
        },
      });
      await funnelV2ReplaceUi(platformUserId, chatId, () =>
        tgSendMessage(
          chatId,
          "В этом шаблоне нет партнёра по умолчанию. Пришли фото второго героя, потом Подтвердить.",
        ),
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
      photo2Url,
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
  /** When true, photo was for slot 2 — re-open confirm instead of auto-start. */
  wasPhoto2?: boolean;
}) {
  const rows = await listVideoRows(opts.userId, opts.locale);
  const row = rows.find(
    (r) => r.id === opts.pending.id && r.kind === opts.pending.kind,
  );
  // Dual-cast and single templates: the photo belongs to this confirm step.
  if (row) {
    await sendVideoConfirm(opts.chatId, opts.platformUserId, row);
    return;
  }
  await tgSendMessage(
    opts.chatId,
    "Шаблон не найден. Открой раздел ещё раз и выбери его.",
  );
}
