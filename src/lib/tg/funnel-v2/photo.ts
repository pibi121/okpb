/**
 * Funnel v2 — «Раздеть и сделать фото»: undress + PhotoTemplate poses.
 */
import { prisma } from "@/lib/db";
import type { TgLocale } from "@/lib/tg/i18n";
import { undressPeaches, peachesToUsdt } from "@/lib/tg-pricing";
import { tgAbsoluteUrl } from "@/lib/tg/media-assets";
import {
  tgAnswerCallbackQuery,
  tgSendMessage,
  tgSendPhoto,
  tgSendPhotoFile,
  tgSendVideo,
} from "@/lib/tg/telegram-api";
import { setTgSession, parsePending, getTgSession } from "@/lib/tg/session";
import { FV2 } from "@/lib/tg/funnel-v2/callbacks";
import {
  debitFunnelBalance,
  getFunnelBalance,
} from "@/lib/tg/funnel-v2/mode";
import { saveGalleryBinary } from "@/lib/local-store";
import { funnelV2ReplaceUi } from "@/lib/tg/funnel-v2/ui";

const PAGE_SIZE = 6;

type PhotoTpl = {
  id: string;
  title: string;
  tgDisplayTitle: string;
  pricePeaches: number;
  previewImageUrl: string;
  previewVideoUrl: string;
  notes: string;
};

async function listPhotoTemplates(): Promise<PhotoTpl[]> {
  const rows = await prisma.photoTemplate.findMany({
    where: { tgPublished: true, published: true },
    orderBy: [{ sortOrder: "asc" }, { updatedAt: "desc" }],
    take: 60,
  });
  return rows.map((r) => ({
    id: r.id,
    title: r.tgDisplayTitle || r.title,
    tgDisplayTitle: r.tgDisplayTitle,
    pricePeaches: r.pricePeaches,
    previewImageUrl: r.previewImageUrl,
    previewVideoUrl: r.previewVideoUrl,
    notes: r.notes || "",
  }));
}

function priceLine(peaches: number): string {
  const usdt = peachesToUsdt(peaches);
  return `${peaches}🍑 (${peaches} рублей / ${usdt}$)`;
}

async function activePhotoUrl(
  platformUserId: string,
): Promise<string | null> {
  const s = await getTgSession(platformUserId);
  const p = parsePending(s?.pendingJson || "{}");
  const url = (p as { funnelV2PhotoUrl?: string }).funnelV2PhotoUrl;
  return url?.trim() || null;
}

/** Telegram cannot fetch private /api/media — upload bytes when we have a local file. */
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
    return (await tgSendPhotoFile(
      chatId,
      bytes,
      "ref.jpg",
      caption,
      { reply_markup },
    )) as { message_id?: number };
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

export async function sendFunnelV2PhotoHub(
  chatId: number,
  userId: string,
  platformUserId: string,
  locale: TgLocale,
  page = 0,
) {
  const photoUrl = await activePhotoUrl(platformUserId);
  const tpls = await listPhotoTemplates();
  const pages = Math.max(1, Math.ceil(tpls.length / PAGE_SIZE));
  const p = Math.min(Math.max(0, page), pages - 1);
  const slice = tpls.slice(p * PAGE_SIZE, p * PAGE_SIZE + PAGE_SIZE);

  const header = photoUrl
    ? "<b>Фотография загружена</b>, но ты можешь заменить её на другую"
    : "<b>Фотография пока не загружена</b>";
  const body =
    `${header}\n\n` +
    `Просто выбери шаблон и сделай с ней всё, что захочешь 😍`;

  const rows: Array<Array<Record<string, unknown>>> = [
    [
      {
        text: "💥Раздеть полностью",
        callback_data: FV2.phUndress,
        style: "danger",
      },
    ],
  ];
  for (let i = 0; i < slice.length; i += 2) {
    const a = slice[i]!;
    const b = slice[i + 1];
    const row = [{ text: a.title.slice(0, 40), callback_data: FV2.phTpl(a.id) }];
    if (b) {
      row.push({
        text: b.title.slice(0, 40),
        callback_data: FV2.phTpl(b.id),
      });
    }
    rows.push(row);
  }
  if (pages > 1) {
    const nav: Array<Record<string, unknown>> = [];
    if (p > 0) nav.push({ text: "⬅️", callback_data: FV2.phPage(p - 1) });
    if (p < pages - 1) {
      nav.push({ text: "Ещё шаблоны➡️", callback_data: FV2.phPage(p + 1) });
    }
    if (nav.length) rows.push(nav);
  }
  if (photoUrl) {
    rows.push([
      {
        text: "Сменить фото",
        callback_data: FV2.phChange,
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
      const { sendCoverPhoto } = await import("@/lib/tg/funnel-v2/media");
      return sendCoverPhoto(chatId, "photoPlaceholder", body, markup);
    } catch {
      return (await tgSendMessage(chatId, body, {
        reply_markup: markup,
      })) as { message_id?: number };
    }
  });
  void userId;
  void locale;
}

async function sendConfirm(
  chatId: number,
  platformUserId: string,
  opts: {
    kind: "ud" | "tpl";
    id: string;
    title: string;
    notes: string;
    price: number;
    previewImageUrl?: string;
    previewVideoUrl?: string;
    hasPhoto: boolean;
  },
) {
  const emoji = opts.kind === "ud" ? "📷" : "📷";
  const notesBlock = opts.notes
    ? `${opts.notes.slice(0, 400)}\n\n`
    : "";
  const text =
    `${emoji} <b>${opts.title}</b>\n\n` +
    notesBlock +
    `Стоимость: ${priceLine(opts.price)}\n\n` +
    `<a href="${tgAbsoluteUrl("/tg/guide")}">🔗 Инструкция, как использовать шаблон и примеры</a>`;

  const kb = {
    inline_keyboard: [
      [
        {
          text: "Отменить",
          callback_data: FV2.phCancel,
          style: "danger",
        },
        {
          text: "Подтвердить✔️",
          callback_data: FV2.phConfirm(opts.kind, opts.id),
          style: "success",
        },
      ],
    ],
  };

  const vid = (opts.previewVideoUrl || "").trim();
  const img = (opts.previewImageUrl || "").trim();
  await funnelV2ReplaceUi(platformUserId, chatId, async () => {
    try {
      if (vid) {
        return (await tgSendVideo(
          chatId,
          vid.startsWith("http") ? vid : tgAbsoluteUrl(vid),
          text,
          { reply_markup: kb },
        )) as { message_id?: number };
      }
      if (img) {
        return (await tgSendPhoto(
          chatId,
          img.startsWith("http") ? img : tgAbsoluteUrl(img),
          text,
          { reply_markup: kb },
        )) as { message_id?: number };
      }
    } catch {
      /* fall through */
    }
    return (await tgSendMessage(chatId, text, {
      reply_markup: kb,
    })) as { message_id?: number };
  });
  void opts.hasPhoto;
}

export async function handleFunnelV2PhotoCallback(opts: {
  chatId: number;
  userId: string;
  platformUserId: string;
  locale: TgLocale;
  data: string;
  callbackId?: string;
}): Promise<boolean> {
  const { chatId, userId, platformUserId, locale, data } = opts;

  if (data === FV2.photo || data === FV2.phAgain) {
    await sendFunnelV2PhotoHub(chatId, userId, platformUserId, locale, 0);
    return true;
  }
  if (data === FV2.phCancel) {
    await sendFunnelV2PhotoHub(chatId, userId, platformUserId, locale, 0);
    return true;
  }
  if (data === FV2.phChange) {
    await setTgSession(platformUserId, {
      chatState: "funnel_v2_awaiting_photo",
      pending: { funnelV2AwaitReplace: true },
    });
    await funnelV2ReplaceUi(platformUserId, chatId, () =>
      tgSendMessage(
        chatId,
        "Пришли новое фото одним сообщением (файл или сжатое фото).",
      ),
    );
    return true;
  }
  const pageM = /^fv2:ph:p:(\d+)$/.exec(data);
  if (pageM) {
    await sendFunnelV2PhotoHub(
      chatId,
      userId,
      platformUserId,
      locale,
      Number(pageM[1]),
    );
    return true;
  }
  if (data === FV2.phUndress) {
    const hasPhoto = Boolean(await activePhotoUrl(platformUserId));
    await sendConfirm(chatId, platformUserId, {
      kind: "ud",
      id: "undress",
      title: "Раздеть полностью",
      notes:
        "Она готова раздеться перед тобой - показать свою грудь, киску и попку, чтобы ты насладился её телом",
      price: undressPeaches(),
      hasPhoto,
      previewVideoUrl: "/tg/media/funnel-undress-preview.mp4",
    });
    return true;
  }
  const tplM = /^fv2:ph:t:(.+)$/.exec(data);
  if (tplM) {
    const id = tplM[1]!;
    const row = await prisma.photoTemplate.findFirst({
      where: { id, tgPublished: true },
    });
    if (!row) {
      if (opts.callbackId) {
        await tgAnswerCallbackQuery(opts.callbackId, "Шаблон не найден");
      }
      return true;
    }
    await sendConfirm(chatId, platformUserId, {
      kind: "tpl",
      id: row.id,
      title: row.tgDisplayTitle || row.title,
      notes: row.notes || "",
      price: row.pricePeaches,
      previewImageUrl: row.previewImageUrl,
      previewVideoUrl: row.previewVideoUrl,
      hasPhoto: Boolean(await activePhotoUrl(platformUserId)),
    });
    return true;
  }

  const okM = /^fv2:ph:ok:(ud|tpl):(.+)$/.exec(data);
  if (okM) {
    const kind = okM[1] as "ud" | "tpl";
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
        pending: { funnelV2PendingConfirm: { kind, id } },
      });
      await funnelV2ReplaceUi(platformUserId, chatId, () =>
        tgSendMessage(
          chatId,
          "Сначала пришли фото одним сообщением, потом снова нажми Подтвердить.",
        ),
      );
      return true;
    }
    await runFunnelV2PhotoGen({
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

async function loadPhotoBytes(photoUrl: string): Promise<Buffer> {
  if (photoUrl.startsWith("/api/media/") || photoUrl.startsWith("/")) {
    const { localBytesFromResultUrl } = await import("@/lib/peach-lab");
    const buf = await localBytesFromResultUrl(photoUrl);
    if (buf?.length) return buf;
  }
  const abs = photoUrl.startsWith("http") ? photoUrl : tgAbsoluteUrl(photoUrl);
  const res = await fetch(abs);
  if (!res.ok) throw new Error("photo fetch failed");
  return Buffer.from(await res.arrayBuffer());
}

async function runFunnelV2PhotoGen(opts: {
  chatId: number;
  userId: string;
  platformUserId: string;
  locale: TgLocale;
  kind: "ud" | "tpl";
  templateId: string;
  photoUrl: string;
}) {
  const user = await prisma.user.findUnique({ where: { id: opts.userId } });
  if (!user) return;

  const price =
    opts.kind === "ud"
      ? undressPeaches()
      : (
          await prisma.photoTemplate.findUnique({
            where: { id: opts.templateId },
          })
        )?.pricePeaches || 0;

  const bal = await getFunnelBalance(user);
  const blurUsed = user.tgFunnelV2BlurTrialsUsed || 0;

  if (bal < price && blurUsed >= 2) {
    const { sendCoverPhoto } = await import("@/lib/tg/funnel-v2/media");
    await funnelV2ReplaceUi(opts.platformUserId, opts.chatId, () =>
      sendCoverPhoto(
        opts.chatId,
        "needTopup",
        "Сейчас я не могу сгенерировать фото для тебя, пока ты не пополнишь баланс.\n\n" +
          "Достаточно один раз пополнить, чтобы генерировать фото и видео по 1 фото на любой вкус, без размытия и получать максимум удовольствия.\n\n" +
          "Сейчас тебя ждёт много бонусных 🍑 за пополнение баланса. Нажми кнопку ниже, чтобы проверить",
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
      ),
    );
    return;
  }

  const useBlur = bal < price;
  if (!useBlur) {
    const deb = await debitFunnelBalance(opts.userId, price);
    if (!deb.ok) {
      await tgSendMessage(opts.chatId, "Недостаточно персиков.");
      return;
    }
  } else {
    await prisma.user.update({
      where: { id: opts.userId },
      data: { tgFunnelV2BlurTrialsUsed: blurUsed + 1 },
    });
  }

  await funnelV2ReplaceUi(opts.platformUserId, opts.chatId, () =>
    tgSendMessage(
      opts.chatId,
      "⏳ <b>Оу, сейчас я буду творить!</b>\n\nМне нужно немного времени, скоро отправлю фото",
    ),
  );

  try {
    const bytes = await loadPhotoBytes(opts.photoUrl);
    if (opts.kind === "ud") {
      // Reuse undress pipeline via temporary free credit after funnel debit.
      await prisma.user.update({
        where: { id: opts.userId },
        data: { tgUndressFreeCredits: { increment: 1 } },
      });
      const { startTgUndressGeneration } = await import(
        "@/lib/tg/undress-service"
      );
      await startTgUndressGeneration({
        userId: opts.userId,
        platformUserId: opts.platformUserId,
        photoBytes: bytes,
        locale: opts.locale,
        funnelV2: !useBlur,
        funnelV2Blur: useBlur,
      });
      return;
    }

    // Template pose — photo-edit lab graph (editPrompt from PhotoTemplate).
    const tpl = await prisma.photoTemplate.findUnique({
      where: { id: opts.templateId },
    });
    if (!tpl?.editPrompt) throw new Error("Шаблон без промпта");

    const { enqueueGpuJob } = await import("@/lib/gallery-jobs");
    const { GALLERY_PLACEHOLDER_URL } = await import("@/lib/gallery-meta");
    const { runPhotoEditLabBytes } = await import("@/lib/photo-edit-lab");
    const { applyTeaseFromLabPreset } = await import(
      "@/lib/tease-overlay-apply"
    );

    const item = await prisma.galleryItem.create({
      data: {
        userId: opts.userId,
        kind: "photo",
        title: tpl.tgDisplayTitle || tpl.title,
        prompt: tpl.editPrompt.slice(0, 500),
        resultUrl: GALLERY_PLACEHOLDER_URL,
        metaJson: JSON.stringify({
          status: "pending",
          engine: "funnel_v2_photo_edit",
          source: "funnel_v2",
          blurTrial: useBlur,
          templateId: tpl.id,
        }),
      },
    });

    const chatId = opts.chatId;
    const platformUserId = opts.platformUserId;
    void enqueueGpuJob(async () => {
      try {
        let out = await runPhotoEditLabBytes({
          photoBytes: bytes,
          editPrompt: tpl.editPrompt,
        });
        if (useBlur) {
          try {
            out = await applyTeaseFromLabPreset(out);
          } catch {
            /* keep clear if tease fails */
          }
        }
        const saved = saveGalleryBinary(opts.userId, "png", out, "fv2_photo");
        await prisma.galleryItem.update({
          where: { id: item.id },
          data: {
            resultUrl: saved.publicUrl,
            metaJson: JSON.stringify({
              status: "ready",
              engine: "funnel_v2_photo_edit",
              source: "funnel_v2",
              blurTrial: useBlur,
              templateId: tpl.id,
              localKey: saved.relKey,
            }),
          },
        });
        const { enqueueTgOutbox } = await import("@/lib/tg/session");
        await enqueueTgOutbox({
          userId: opts.userId,
          platformUserId,
          kind: "photo",
          payload: {
            url: saved.publicUrl,
            caption: "",
            successKind: useBlur ? "funnel_v2_blur" : "funnel_v2_photo",
            galleryItemId: item.id,
            funnelV2: true,
            blurTrial: useBlur,
            locale: opts.locale,
          },
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await prisma.galleryItem.update({
          where: { id: item.id },
          data: {
            metaJson: JSON.stringify({
              status: "error",
              error: msg,
              source: "funnel_v2",
            }),
          },
        });
        await tgSendMessage(chatId, `Ошибка генерации: ${msg}`).catch(
          () => undefined,
        );
      }
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await tgSendMessage(opts.chatId, `Не удалось запустить: ${msg}`);
  }
}

/** Save incoming photo for funnel v2 and optionally resume confirm. */
export async function handleFunnelV2PhotoUpload(opts: {
  chatId: number;
  userId: string;
  platformUserId: string;
  locale: TgLocale;
  photoBytes: Buffer;
}): Promise<void> {
  const saved = saveGalleryBinary(
    opts.userId,
    "jpg",
    opts.photoBytes,
    "fv2_ref",
  );
  const session = await getTgSession(opts.platformUserId);
  const pending = parsePending(session?.pendingJson || "{}") as {
    funnelV2PendingConfirm?: { kind: "ud" | "tpl"; id: string };
    funnelV2PendingVideoConfirm?: { kind: "qv" | "li2v"; id: string };
    funnelV2ReturnTo?: string;
  };
  await setTgSession(opts.platformUserId, {
    chatState: "idle",
    pending: {
      funnelV2PhotoUrl: saved.publicUrl,
      funnelV2PhotoKey: saved.relKey,
    },
  });
  await tgSendMessage(opts.chatId, "Фото сохранено ✅");
  const pendingConfirm = pending.funnelV2PendingConfirm;
  if (pendingConfirm) {
    await runFunnelV2PhotoGen({
      chatId: opts.chatId,
      userId: opts.userId,
      platformUserId: opts.platformUserId,
      locale: opts.locale,
      kind: pendingConfirm.kind,
      templateId: pendingConfirm.id,
      photoUrl: saved.publicUrl,
    });
    return;
  }
  if (pending.funnelV2PendingVideoConfirm) {
    const { resumeFunnelV2VideoAfterPhoto } = await import(
      "@/lib/tg/funnel-v2/video"
    );
    await resumeFunnelV2VideoAfterPhoto({
      chatId: opts.chatId,
      userId: opts.userId,
      platformUserId: opts.platformUserId,
      locale: opts.locale,
      photoUrl: saved.publicUrl,
      pending: pending.funnelV2PendingVideoConfirm,
    });
    return;
  }
  if (pending.funnelV2ReturnTo === "video") {
    const { sendFunnelV2VideoHub } = await import("@/lib/tg/funnel-v2/video");
    await sendFunnelV2VideoHub(
      opts.chatId,
      opts.userId,
      opts.platformUserId,
      opts.locale,
      0,
    );
    return;
  }
  await sendFunnelV2PhotoHub(
    opts.chatId,
    opts.userId,
    opts.platformUserId,
    opts.locale,
    0,
  );
}
