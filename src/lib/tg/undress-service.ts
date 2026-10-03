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
import { runUndressBytes } from "@/lib/tg/undress-comfy";
import { comfyFreeMemory } from "@/lib/comfy-client";
import { debitPeaches, creditPeaches } from "@/lib/tg/wallet";
import { enqueueTgOutbox } from "@/lib/tg/session";
import { useComfy } from "@/lib/metalnode-config";
import type { TgLocale } from "@/lib/tg/i18n";

export async function startTgUndressGeneration(opts: {
  userId: string;
  platformUserId: string;
  photoBytes: Buffer;
  locale: TgLocale;
  /** Funnel v2 result keyboard instead of classic undress CTAs */
  funnelV2?: boolean;
  /** Funnel v2 trial: apply tease blur; no paid result CTAs */
  funnelV2Blur?: boolean;
  /**
   * Already debited from funnel wallet — skip peach/free charge;
   * store as chargedPeaches for QC refund.
   */
  funnelChargedPeaches?: number;
  /** Stored on gallery meta for «Снять блюр» after topup. */
  unblurRecipe?: {
    kind: "ud" | "tpl";
    templateId: string;
    photoUrl: string;
    photoKey?: string;
    price: number;
    poseTitle: string;
  };
}): Promise<{
  galleryItemId: string;
  chargedPeaches: number;
  usedFree: boolean;
}> {
  const { assertImageAllowedForGeneration } = await import("@/lib/age-gate");
  await assertImageAllowedForGeneration(opts.photoBytes, opts.locale, {
    userId: opts.userId,
  });

  await ensureUndressWelcome(opts.userId);

  const user = await prisma.user.findUnique({ where: { id: opts.userId } });
  if (!user) throw new Error("user not found");

  const price = undressPeaches();
  let usedFree = false;
  let chargedPeaches = 0;
  const funnelPaid = Math.max(0, Math.floor(opts.funnelChargedPeaches || 0));

  if (funnelPaid > 0) {
    chargedPeaches = funnelPaid;
    usedFree = false;
  } else if (user.tgUndressFreeCredits >= 1) {
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
      prompt: "undress_krea",
      resultUrl: GALLERY_PLACEHOLDER_URL,
      metaJson: JSON.stringify({
        status: "pending",
        engine: "krea2_undress",
        chargedPeaches,
        undressFreeUsed: usedFree,
        source: opts.funnelV2 || opts.funnelV2Blur ? "funnel_v2" : "tg_undress",
        funnelV2: Boolean(opts.funnelV2 || opts.funnelV2Blur),
        blurTrial: Boolean(opts.funnelV2Blur),
        ...(opts.funnelV2Blur ? { hiddenFromTgGallery: true } : {}),
        ...(opts.unblurRecipe ? { unblurRecipe: opts.unblurRecipe } : {}),
      }),
    },
  });

  const photoBytes = opts.photoBytes;
  const platformUserId = opts.platformUserId;
  const locale = opts.locale;
  const galleryItemId = item.id;
  const funnelV2 = Boolean(opts.funnelV2);
  const funnelV2Blur = Boolean(opts.funnelV2Blur);
  const funnelPaidAmt = funnelPaid;
  const unblurRecipe = opts.unblurRecipe;

  void enqueueGpuJob(
    async () => {
      try {
        let bytes: Buffer;
        if (!useComfy()) {
          bytes = photoBytes;
        } else {
          try {
            bytes = await runUndressBytes(photoBytes);
          } catch (first) {
            const msg = first instanceof Error ? first.message : String(first);
            const isOom = /OutOfMemory|CUDA out of memory|ran out of memory/i.test(
              msg,
            );
            // Soft recover: transient Comfy flakes / brief VRAM pressure.
            // Keep Funnel v2 hooks above; owner OOM path frees VRAM before retry.
            if (
              isOom ||
              /Comfy job error|Comfy wait timeout|wait timeout|ECONN|ETIMEDOUT|socket hang|tunnel|Bad Gateway|EAI_AGAIN/i.test(
                msg,
              )
            ) {
              console.warn("[undress] retry once after:", msg.slice(0, 160));
              await comfyFreeMemory();
              await new Promise((r) => setTimeout(r, isOom ? 12_000 : 2500));
              await comfyFreeMemory();
              bytes = await runUndressBytes(photoBytes);
            } else {
              throw first;
            }
          }
        }
        if (funnelV2Blur) {
          try {
            const { applyTeaseFromLabPreset } = await import(
              "@/lib/tease-overlay-apply"
            );
            bytes = await applyTeaseFromLabPreset(bytes);
          } catch (blurErr) {
            console.warn("[undress] funnel blur failed:", blurErr);
          }
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
              engine: "krea2_undress",
              chargedPeaches,
              undressFreeUsed: usedFree,
              source: funnelV2 || funnelV2Blur ? "funnel_v2" : "tg_undress",
              funnelV2: funnelV2 || funnelV2Blur,
              blurTrial: funnelV2Blur,
              ...(funnelV2Blur ? { hiddenFromTgGallery: true } : {}),
              ...(unblurRecipe ? { unblurRecipe } : {}),
            }),
          },
        });
        const successKind = funnelV2Blur
          ? "funnel_v2_blur"
          : funnelV2
            ? "funnel_v2_photo"
            : "undress";
        if (funnelV2 || funnelV2Blur) {
          const { enqueueFunnelV2Result } = await import(
            "@/lib/tg/funnel-v2/enqueue-result"
          );
          const blurCaption = funnelV2Blur
            ? `Готово! Я сделал фото с ней в позе: «${unblurRecipe?.poseTitle || "Раздеть полностью"}»\n\n` +
              `Это пробное фото и оно заблюрено. Чтобы сделать фото без блюра, превратить его в видео или отредактировать — пополни баланс. ` +
              `За первое пополнение баланса в течение ближайших 30 минут тебе начислим много бонусов\n\n` +
              `Пополните баланс на нужную сумму\n👇👇👇`
            : undefined;
          await enqueueFunnelV2Result({
            userId: opts.userId,
            platformUserId,
            locale,
            kind: "photo",
            url: saved.publicUrl,
            galleryItemId,
            successKind: funnelV2Blur ? "funnel_v2_blur" : "funnel_v2_photo",
            blurTrial: funnelV2Blur,
            offerQcDislike: funnelV2 && !funnelV2Blur && chargedPeaches > 0,
            caption: blurCaption,
            extraPayload: {
              chargedPeaches,
              undressFreeUsed: usedFree,
              ...(unblurRecipe
                ? {
                    poseTitle: unblurRecipe.poseTitle,
                    pricePeaches: unblurRecipe.price,
                  }
                : {}),
            },
          });
          if (funnelV2Blur) {
            const { markFunnelV2BlurOffered } = await import(
              "@/lib/tg/funnel-v2/faststart"
            );
            await markFunnelV2BlurOffered(opts.userId);
          }
        } else {
          await enqueueTgOutbox({
            platformUserId,
            userId: opts.userId,
            kind: "photo",
            payload: {
              url: saved.publicUrl,
              caption: "",
              successKind,
              galleryItemId,
              chargedPeaches,
              undressFreeUsed: usedFree,
              locale,
            },
          });
        }
      } catch (e) {
        console.error("[undress] job failed:", e);
        if (funnelPaidAmt > 0) {
          const { creditFunnelBalance } = await import(
            "@/lib/tg/funnel-v2/mode"
          );
          await creditFunnelBalance(opts.userId, funnelPaidAmt).catch(
            () => undefined,
          );
        } else if (usedFree) {
          await restoreUndressFree(opts.userId).catch(() => undefined);
        } else if (chargedPeaches > 0) {
          await creditPeaches(opts.userId, chargedPeaches, "tg_undress_refund", {
            galleryItemId,
          }).catch(() => undefined);
        }
        if (funnelV2Blur) {
          try {
            const u = await prisma.user.findUnique({
              where: { id: opts.userId },
              select: { tgFunnelV2BlurTrialsUsed: true },
            });
            const used = u?.tgFunnelV2BlurTrialsUsed || 0;
            if (used > 0) {
              await prisma.user.update({
                where: { id: opts.userId },
                data: { tgFunnelV2BlurTrialsUsed: used - 1 },
              });
            }
          } catch {
            /* ignore */
          }
        }
        await prisma.galleryItem.update({
          where: { id: galleryItemId },
          data: {
            metaJson: JSON.stringify({
              status: "error",
              engine: "krea2_undress",
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
      // Projector + Realism v3.1 are on Metalnode only (not on RunPod volume yet).
      providers: ["metalnode"],
      meta: { undress: true, engine: "krea2_undress" },
    },
  );

  return { galleryItemId, chargedPeaches, usedFree };
}
