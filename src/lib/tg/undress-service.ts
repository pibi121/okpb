/**
 * Start TG undress job: charge free/peaches → GPU → gallery → outbox.
 */
import { prisma } from "@/lib/db";
import { enqueueGpuJob } from "@/lib/gallery-jobs";
import { GALLERY_PLACEHOLDER_URL } from "@/lib/gallery-meta";
import { saveGalleryBinary } from "@/lib/local-store";
import { undressPeaches } from "@/lib/tg-pricing";
import {
  consumeUndressFree,
  ensureUndressWelcome,
  restoreUndressFree,
} from "@/lib/tg/undress-entitlement";
import { runH3UndressBytes } from "@/lib/tg/undress-comfy";
import { debitPeaches, creditPeaches } from "@/lib/tg/wallet";
import { enqueueTgOutbox } from "@/lib/tg/session";
import { useComfy } from "@/lib/metalnode-config";
import type { TgLocale } from "@/lib/tg/i18n";

export async function startTgUndressGeneration(opts: {
  userId: string;
  platformUserId: string;
  photoBytes: Buffer;
  locale: TgLocale;
}): Promise<{
  galleryItemId: string;
  chargedPeaches: number;
  usedFree: boolean;
}> {
  await ensureUndressWelcome(opts.userId);

  const user = await prisma.user.findUnique({ where: { id: opts.userId } });
  if (!user) throw new Error("user not found");

  const price = undressPeaches();
  let usedFree = false;
  let chargedPeaches = 0;

  if (user.tgUndressFreeCredits >= 1) {
    const ok = await consumeUndressFree(opts.userId);
    if (!ok) throw new Error("free_race");
    usedFree = true;
    chargedPeaches = 0;
  } else {
    const paid = await debitPeaches(opts.userId, price, "tg_undress", {});
    if (!paid.ok) {
      throw new Error(
        `Недостаточно персиков (нужно ${price}, есть ${paid.balance})`,
      );
    }
    chargedPeaches = price;
  }

  const item = await prisma.galleryItem.create({
    data: {
      userId: opts.userId,
      kind: "photo",
      title: opts.locale === "en" ? "Undress" : "Раздеть",
      prompt: "undress_h3",
      resultUrl: GALLERY_PLACEHOLDER_URL,
      metaJson: JSON.stringify({
        status: "pending",
        engine: "h3_undress",
        chargedPeaches,
        undressFreeUsed: usedFree,
        source: "tg_undress",
      }),
    },
  });

  const photoBytes = opts.photoBytes;
  const platformUserId = opts.platformUserId;
  const locale = opts.locale;
  const galleryItemId = item.id;

  void enqueueGpuJob(
    async () => {
      try {
        let bytes: Buffer;
        if (!useComfy()) {
          bytes = photoBytes;
        } else {
          bytes = await runH3UndressBytes(photoBytes);
        }
        const saved = saveGalleryBinary(
          opts.userId,
          "png",
          bytes,
          `tg_undress_${galleryItemId}`,
        );
        await prisma.galleryItem.update({
          where: { id: galleryItemId },
          data: {
            resultUrl: saved.publicUrl,
            metaJson: JSON.stringify({
              status: "ready",
              engine: "h3_undress",
              chargedPeaches,
              undressFreeUsed: usedFree,
              source: "tg_undress",
            }),
          },
        });
        await enqueueTgOutbox({
          platformUserId,
          userId: opts.userId,
          kind: "photo",
          payload: {
            url: saved.publicUrl,
            caption: "",
            successKind: "undress",
            galleryItemId,
            chargedPeaches,
            undressFreeUsed: usedFree,
            locale,
          },
        });
      } catch (e) {
        console.error("[undress] job failed:", e);
        if (usedFree) {
          await restoreUndressFree(opts.userId).catch(() => undefined);
        } else if (chargedPeaches > 0) {
          await creditPeaches(opts.userId, chargedPeaches, "tg_undress_refund", {
            galleryItemId,
          }).catch(() => undefined);
        }
        await prisma.galleryItem.update({
          where: { id: galleryItemId },
          data: {
            metaJson: JSON.stringify({
              status: "error",
              engine: "h3_undress",
              error: e instanceof Error ? e.message.slice(0, 400) : String(e),
              chargedPeaches,
              undressFreeUsed: usedFree,
            }),
          },
        });
        await enqueueTgOutbox({
          platformUserId,
          userId: opts.userId,
          kind: "error",
          payload: {
            text:
              locale === "en"
                ? "Undress failed — peaches / free credit restored. Try again."
                : "Раздевание не удалось — персики / бесплатный кредит возвращены. Попробуй ещё раз.",
            locale,
          },
        });
        throw e;
      }
    },
    {
      userId: opts.userId,
      kind: "photo_undress",
      title: "undress",
      refType: "galleryItem",
      refId: galleryItemId,
      pool: "photo",
      // H3 undress needs CLIP type "minimax" — RunPod stock Comfy lacks it.
      providers: ["metalnode"],
      meta: { undress: true },
    },
  );

  return { galleryItemId, chargedPeaches, usedFree };
}
