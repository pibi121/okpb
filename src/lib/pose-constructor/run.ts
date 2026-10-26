import fs from "node:fs";
import { prisma } from "@/lib/db";
import { comfyUploadImage, runComfyJob } from "@/lib/comfy-client";
import { enqueueGpuJob } from "@/lib/gallery-jobs";
import { GALLERY_PLACEHOLDER_URL } from "@/lib/gallery-meta";
import { saveGalleryBinary, resolveGalleryFile, localPathFromResultUrl } from "@/lib/local-store";
import { stitchClipBuffersWithFallback } from "@/lib/stitch-fallback";
import { QC_CB } from "@/lib/tg/generation-flow";
import { creditFunnelBalance } from "@/lib/tg/funnel-v2/mode";
import { formatRubOnly } from "@/lib/tg/funnel-v2/money";
import { FV2 } from "@/lib/tg/funnel-v2/callbacks";
import { setTgSession } from "@/lib/tg/session";
import { tgSendMessage, tgSendVideoFile } from "@/lib/tg/telegram-api";
import {
  POSE_DEFAULT_MAN,
  poseById,
  poseOrderPrice,
  posePriceRub,
} from "@/lib/pose-constructor/catalog";
import { buildPoseClipGraph } from "@/lib/pose-constructor/graph";

function readPhoto(key: string): Buffer {
  const abs = resolveGalleryFile(key);
  if (!abs || !fs.existsSync(abs)) throw new Error("Фото не найдено");
  return fs.readFileSync(abs);
}

function parseMeta(raw: string | null | undefined): Record<string, unknown> {
  try {
    return JSON.parse(raw || "{}") as Record<string, unknown>;
  } catch {
    return {};
  }
}

export async function mergePoseItemMeta(
  itemId: string,
  patch: Record<string, unknown>,
) {
  const row = await prisma.galleryItem.findUnique({
    where: { id: itemId },
    select: { metaJson: true },
  });
  if (!row) return;
  await prisma.galleryItem.update({
    where: { id: itemId },
    data: { metaJson: JSON.stringify({ ...parseMeta(row.metaJson), ...patch }) },
  });
}

export async function deliverPoseFilm(opts: {
  chatId: number;
  userId: string;
  itemId: string;
  quoteRub: number;
  per: number;
  clips: Buffer[];
  okTitles: string[];
  failTitles: string[];
}): Promise<void> {
  const row = await prisma.galleryItem.findUnique({
    where: { id: opts.itemId },
    select: { metaJson: true, resultUrl: true },
  });
  const prev = parseMeta(row?.metaJson);
  if (prev.status === "ready" && prev.poseSent === true) return;
  if (prev.status === "ready" && row?.resultUrl) {
    const abs = localPathFromResultUrl(row.resultUrl);
    if (abs && fs.existsSync(abs)) {
      await sendPoseReady(opts, prev, true, fs.readFileSync(abs));
      return;
    }
  }

  const due = opts.clips.length
    ? opts.failTitles.length * opts.per
    : opts.quoteRub;
  const already = Math.max(0, Math.round(Number(prev.refundedPeaches) || 0));
  const delta = Math.max(0, due - already);
  if (delta > 0) await creditFunnelBalance(opts.userId, delta);
  const refunded = already + delta;

  if (!opts.clips.length) {
    await mergePoseItemMeta(opts.itemId, {
      status: "error",
      error: "Ни одна сцена не собралась",
      refundedPeaches: refunded,
      failed: opts.failTitles,
      poseSent: true,
    });
    await tgSendMessage(
      opts.chatId,
      `Ни одна сцена не собралась. Вернул ${formatRubOnly(refunded)}.`,
    );
    await setTgSession(String(opts.chatId), { pending: { poseRunning: false } }).catch(
      () => undefined,
    );
    return;
  }

  let video = opts.clips[0]!;
  let glued = opts.clips.length === 1;
  if (opts.clips.length > 1) {
    try {
      const stitched = await stitchClipBuffersWithFallback({
        clips: opts.clips,
        tag: "pose",
      });
      video = stitched.bytes;
      glued = true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[pose] stitch failed: ${msg}`);
      glued = false;
    }
  }

  const saved = saveGalleryBinary(opts.userId, "mp4", video, "pose_film");
  await prisma.galleryItem.update({
    where: { id: opts.itemId },
    data: {
      prompt: opts.okTitles.join(", "),
      resultUrl: saved.publicUrl,
      metaJson: JSON.stringify({
        ...prev,
        status: "ready",
        poseBuilder: true,
        chargedPeaches: opts.quoteRub,
        refundedPeaches: refunded,
        durationSec: opts.clips.length * 5,
        poses: opts.okTitles,
        failed: opts.failTitles,
        poseSent: false,
      }),
    },
  });
  await sendPoseReady(
    opts,
    { refundedPeaches: refunded },
    glued,
    video,
  );
}

async function sendPoseReady(
  opts: {
    chatId: number;
    itemId: string;
    clips: Buffer[];
    okTitles: string[];
    failTitles: string[];
  },
  prev: Record<string, unknown>,
  glued = true,
  video?: Buffer,
) {
  const refunded = Math.max(0, Math.round(Number(prev.refundedPeaches) || 0));
  const note = opts.failTitles.length
    ? `\nНе собрались: ${opts.failTitles.join(", ")}. Вернул ${formatRubOnly(refunded)}.`
    : "";
  const keyboard = {
    inline_keyboard: [
      [{ text: "Собрать другие позы", callback_data: FV2.pose }],
      [{ text: "В главное меню", callback_data: FV2.hub }],
      [{ text: "Не понравилось видео", callback_data: QC_CB.dislike(opts.itemId) }],
    ],
  };
  const bytes = video || opts.clips[0];
  if (glued && bytes) {
    await tgSendVideoFile(
      opts.chatId,
      bytes,
      "pose.mp4",
      `Готово: ${opts.okTitles.join(" → ")}.${note}`,
      { reply_markup: keyboard },
    );
  } else {
    await tgSendMessage(
      opts.chatId,
      `Склейка не вышла. Отправляю собранные сцены по отдельности.${note}`,
    );
    for (let i = 0; i < opts.clips.length; i++) {
      await tgSendVideoFile(
        opts.chatId,
        opts.clips[i]!,
        `pose_${i + 1}.mp4`,
        opts.okTitles[i] || `Сцена ${i + 1}`,
        i === opts.clips.length - 1 ? { reply_markup: keyboard } : {},
      );
    }
  }
  await mergePoseItemMeta(opts.itemId, { poseSent: true });
  await setTgSession(String(opts.chatId), { pending: { poseRunning: false } }).catch(
    () => undefined,
  );
}

export async function startPoseFilm(opts: {
  chatId: number;
  userId: string;
  poseIds: string[];
  girlKey: string;
  manKey?: string;
}): Promise<void> {
  const ids = opts.poseIds.filter((id) => poseById(id));
  const quote = await poseOrderPrice(ids);
  const per = await posePriceRub();
  const titles = ids.map((id) => poseById(id)?.title || id);

  await tgSendMessage(
    opts.chatId,
    `Собираю ролик: ${titles.join(" → ")}\n` +
      `${quote.sec} сек, списано ${formatRubOnly(quote.rub)}. ` +
      `Если вдруг сцена не соберётся или в ней будут грубые ошибки с нашей стороны, мы вернём за неё деньги`,
  );

  let settled = false;
  let itemId = "";
  try {
    const pending = await prisma.galleryItem.create({
      data: {
        userId: opts.userId,
        kind: "video",
        title: "Конструктор сцен",
        prompt: titles.join(", "),
        resultUrl: GALLERY_PLACEHOLDER_URL,
        metaJson: JSON.stringify({
          status: "pending",
          poseBuilder: true,
          chargedPeaches: quote.rub,
          refundedPeaches: 0,
          durationSec: quote.sec,
          poses: titles,
          poseChatId: opts.chatId,
          poseIds: ids,
          poseGirlKey: opts.girlKey,
          poseManKey: opts.manKey || "",
          poseClips: [],
          poseCursor: "",
        }),
      },
    });
    itemId = pending.id;
    await enqueueGpuJob(
      async () => {
        let refunded = 0;
        try {
          const girlName = await comfyUploadImage(
            "pose_girl.jpg",
            readPhoto(opts.girlKey),
            "image/jpeg",
          );
          let manName = POSE_DEFAULT_MAN;
          if (opts.manKey) {
            manName = await comfyUploadImage(
              "pose_man.jpg",
              readPhoto(opts.manKey),
              "image/jpeg",
            );
          }

          const clips: Buffer[] = [];
          const okTitles: string[] = [];
          const failTitles: string[] = [];
          for (const id of ids) {
            const title = poseById(id)?.title || id;
            try {
              await mergePoseItemMeta(itemId, { poseCursor: id });
              const graph = buildPoseClipGraph({
                girlImage: girlName,
                manImage: manName,
                poseId: id,
                seed: Math.floor(Math.random() * 1_000_000_000),
              });
              const out = await runComfyJob(graph, `pose-${id}`);
              if (!out.bytes?.length) throw new Error("пустой файл");
              const savedClip = saveGalleryBinary(
                opts.userId,
                "mp4",
                out.bytes,
                "pose_clip",
              );
              const current = await prisma.galleryItem.findUnique({
                where: { id: itemId },
                select: { metaJson: true },
              });
              const poseClips = [
                ...((parseMeta(current?.metaJson).poseClips as unknown[]) || []),
                { poseId: id, fileKey: savedClip.relKey, title },
              ];
              await mergePoseItemMeta(itemId, { poseClips, poseCursor: "" });
              clips.push(out.bytes);
              okTitles.push(title);
            } catch (e) {
              const msg = e instanceof Error ? e.message : String(e);
              console.error(`[pose] ${id} failed: ${msg}`);
              failTitles.push(title);
            }
          }

          refunded = failTitles.length * per;
          await deliverPoseFilm({
            chatId: opts.chatId,
            userId: opts.userId,
            itemId,
            quoteRub: quote.rub,
            per,
            clips,
            okTitles,
            failTitles,
          });
          settled = true;
        } catch (e) {
          const left = quote.rub - refunded;
          if (left > 0) await creditFunnelBalance(opts.userId, left);
          settled = true;
          const msg = e instanceof Error ? e.message : String(e);
          if (itemId) {
            await prisma.galleryItem
              .update({
                where: { id: itemId },
                data: {
                  metaJson: JSON.stringify({
                    status: "error",
                    error: msg.slice(0, 300),
                    poseBuilder: true,
                    chargedPeaches: quote.rub,
                    refundedPeaches: quote.rub,
                    poses: titles,
                    failed: titles,
                  }),
                },
              })
              .catch(() => undefined);
          }
          await tgSendMessage(
            opts.chatId,
            `Сборка оборвалась. Вернул ${formatRubOnly(left)}.\n${msg}`,
          );
        }
      },
      {
        pool: "pose",
        userId: opts.userId,
        title: "Конструктор сцен",
        kind: "film",
        refType: "galleryItem",
        refId: itemId,
        meta: { poseBuilder: true, poseCount: ids.length },
      },
    );
  } catch (e) {
    if (!settled) {
      if (itemId) {
        const msg = e instanceof Error ? e.message : String(e);
        await prisma.galleryItem
          .update({
            where: { id: itemId },
            data: {
              metaJson: JSON.stringify({
                status: "error",
                error: msg.slice(0, 300),
                poseBuilder: true,
                chargedPeaches: quote.rub,
                refundedPeaches: quote.rub,
                poses: titles,
              }),
            },
          })
          .catch(() => undefined);
      }
      await creditFunnelBalance(opts.userId, quote.rub);
      const msg = e instanceof Error ? e.message : String(e);
      await tgSendMessage(
        opts.chatId,
        `Не удалось запустить сборку. Вернул ${formatRubOnly(quote.rub)}.\n${msg}`,
      );
    }
  }
}
