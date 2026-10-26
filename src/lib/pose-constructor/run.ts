import fs from "node:fs";
import { prisma } from "@/lib/db";
import { comfyUploadImage, runComfyJob } from "@/lib/comfy-client";
import { enqueueGpuJob } from "@/lib/gallery-jobs";
import { saveGalleryBinary, resolveGalleryFile } from "@/lib/local-store";
import { stitchClipBuffersWithFallback } from "@/lib/stitch-fallback";
import { QC_CB } from "@/lib/tg/generation-flow";
import { creditFunnelBalance } from "@/lib/tg/funnel-v2/mode";
import { formatRubOnly } from "@/lib/tg/funnel-v2/money";
import { FV2 } from "@/lib/tg/funnel-v2/callbacks";
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

export async function startPoseFilm(opts: {
  chatId: number;
  userId: string;
  poseIds: string[];
  girlKey: string;
  manKey?: string;
}): Promise<void> {
  const ids = opts.poseIds.filter((id) => poseById(id));
  const quote = poseOrderPrice(ids);
  const per = posePriceRub();
  const titles = ids.map((id) => poseById(id)?.title || id);

  await tgSendMessage(
    opts.chatId,
    `Собираю ролик: ${titles.join(" → ")}\n` +
      `${quote.sec} сек, списано ${formatRubOnly(quote.rub)}. ` +
      `Если сцена не соберётся, верну деньги только за неё.`,
  );

  let settled = false;
  try {
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
              const graph = buildPoseClipGraph({
                girlImage: girlName,
                manImage: manName,
                poseId: id,
                seed: Math.floor(Math.random() * 1_000_000_000),
              });
              const out = await runComfyJob(graph, `pose-${id}`);
              if (!out.bytes?.length) throw new Error("пустой файл");
              clips.push(out.bytes);
              okTitles.push(title);
            } catch (e) {
              const msg = e instanceof Error ? e.message : String(e);
              console.error(`[pose] ${id} failed: ${msg}`);
              failTitles.push(title);
            }
          }

          refunded = failTitles.length * per;
          if (refunded > 0) await creditFunnelBalance(opts.userId, refunded);

          if (!clips.length) {
            await tgSendMessage(
              opts.chatId,
              `Ни одна сцена не собралась. Вернул ${formatRubOnly(quote.rub)}.`,
            );
            settled = true;
            return;
          }

          let video = clips[0]!;
          let glued = clips.length === 1;
          if (clips.length > 1) {
            try {
              const stitched = await stitchClipBuffersWithFallback({
                clips,
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
          const item = await prisma.galleryItem.create({
            data: {
              userId: opts.userId,
              kind: "video",
              title: "Конструктор сцен",
              prompt: okTitles.join(", "),
              resultUrl: saved.publicUrl,
              metaJson: JSON.stringify({
                status: "ready",
                poseBuilder: true,
                chargedPeaches: quote.rub,
                refundedPeaches: refunded,
                poses: okTitles,
                failed: failTitles,
              }),
            },
          });

          const note = failTitles.length
            ? `\nНе собрались: ${failTitles.join(", ")}. Вернул ${formatRubOnly(refunded)}.`
            : "";
          const keyboard = {
            inline_keyboard: [
              [{ text: "Собрать другие позы", callback_data: FV2.pose }],
              [{ text: "В главное меню", callback_data: FV2.hub }],
              [
                {
                  text: "Не понравилось видео",
                  callback_data: QC_CB.dislike(item.id),
                },
              ],
            ],
          };

          if (glued) {
            await tgSendVideoFile(
              opts.chatId,
              video,
              "pose.mp4",
              `Готово: ${okTitles.join(" → ")}.${note}`,
              { reply_markup: keyboard },
            );
          } else {
            await tgSendMessage(
              opts.chatId,
              `Склейка не вышла. Отправляю собранные сцены по отдельности.${note}`,
            );
            for (let i = 0; i < clips.length; i++) {
              await tgSendVideoFile(
                opts.chatId,
                clips[i]!,
                `pose_${i + 1}.mp4`,
                okTitles[i] || `Сцена ${i + 1}`,
                i === clips.length - 1 ? { reply_markup: keyboard } : {},
              );
            }
          }
          settled = true;
        } catch (e) {
          const left = quote.rub - refunded;
          if (left > 0) await creditFunnelBalance(opts.userId, left);
          settled = true;
          const msg = e instanceof Error ? e.message : String(e);
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
      },
    );
  } catch (e) {
    if (!settled) {
      await creditFunnelBalance(opts.userId, quote.rub);
      const msg = e instanceof Error ? e.message : String(e);
      await tgSendMessage(
        opts.chatId,
        `Не удалось запустить сборку. Вернул ${formatRubOnly(quote.rub)}.\n${msg}`,
      );
    }
  }
}
