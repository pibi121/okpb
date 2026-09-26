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
      }),
    },
  });

  const photoBytes = opts.photoBytes;
  const platformUserId = opts.platformUserId;
  const locale = opts.locale;
  const galleryItemId = item.id;
  const funnelV2 = Boolean(opts.funnelV2);
  const funnelV2Blur = Boolean(opts.funnelV2Blur);

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
            // Soft recover: transient Comfy execution flakes (opaque "Comfy job error").
            if (/Comfy job error|ECONN|ETIMEDOUT|socket hang|tunnel/i.test(msg)) {
              console.warn("[undress] retry once after:", msg.slice(0, 160));
              await new Promise((r) => setTimeout(r, 2500));
              bytes = await runUndressBytes(photoBytes);
            } else {
              throw first;
            }
          }
        }
        if (funnelV2Blur) {
          try {
            const { applyTeaseOverlay } = await import(
              "@/lib/tease-overlay-apply"
            );
            let teasePreset: Record<string, unknown> = { blurPx: 20 };
            try {
              const fs = await import("node:fs");
              const path = await import("node:path");
              const p = path.join(process.cwd(), "presets", "tease_overlay.json");
              if (fs.existsSync(p)) {
                teasePreset = JSON.parse(fs.readFileSync(p, "utf8"));
              }
            } catch {
              /* default */
            }
            bytes = await applyTeaseOverlay(bytes, null, teasePreset);
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
            }),
          },
        });
        const successKind = funnelV2Blur
          ? "funnel_v2_blur"
          : funnelV2
            ? "funnel_v2_photo"
            : "undress";
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
            funnelV2: funnelV2 || funnelV2Blur,
            blurTrial: funnelV2Blur,
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
