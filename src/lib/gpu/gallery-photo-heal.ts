/**
 * Recover / requeue stuck gallery photo jobs after Railway redeploy or
 * lost waiters — mirror of quick-video heal, for undress / photo-edit.
 */
import { prisma } from "@/lib/db";
import { enqueueGpuJob } from "@/lib/gallery-jobs";
import { GALLERY_PLACEHOLDER_URL } from "@/lib/gallery-meta";
import {
  localPathFromResultUrl,
  resolveGalleryFile,
  saveGalleryBinary,
} from "@/lib/local-store";
import fs from "node:fs";

function parseMeta(raw: string | null | undefined): Record<string, unknown> {
  try {
    return JSON.parse(raw || "{}") as Record<string, unknown>;
  } catch {
    return {};
  }
}

function isPhotoHealEngine(meta: Record<string, unknown>): boolean {
  const engine = String(meta.engine || "");
  return (
    meta.undress === true ||
    engine.includes("undress") ||
    engine.includes("photo_edit") ||
    engine === "funnel_v2_photo_edit" ||
    engine === "krea2_undress" ||
    meta.jobAction === "photo" ||
    meta.source === "tg_undress" ||
    meta.source === "funnel_v2"
  );
}

function loadSourceBytes(meta: Record<string, unknown>, sourceUrl: string | null): Buffer | null {
  const key =
    typeof meta.sourceLocalKey === "string" ? meta.sourceLocalKey : "";
  if (key) {
    const abs = resolveGalleryFile(key);
    if (abs && fs.existsSync(abs)) {
      try {
        return fs.readFileSync(abs);
      } catch {
        /* fall through */
      }
    }
  }
  const url =
    (typeof meta.sourceUrl === "string" && meta.sourceUrl) || sourceUrl || "";
  if (url) {
    const abs = localPathFromResultUrl(url);
    if (abs && fs.existsSync(abs)) {
      try {
        return fs.readFileSync(abs);
      } catch {
        /* ignore */
      }
    }
  }
  return null;
}

async function deliverRecoveredPhoto(opts: {
  itemId: string;
  userId: string;
  bytes: Buffer;
  meta: Record<string, unknown>;
  recoveredFrom: string;
}): Promise<boolean> {
  const { itemId, userId, bytes, meta, recoveredFrom } = opts;
  if (!bytes?.length || bytes.length < 100) return false;

  const saved = saveGalleryBinary(userId, "png", bytes, `heal_${itemId}`);
  const funnelV2 = meta.funnelV2 === true || meta.source === "funnel_v2";
  const funnelV2Blur = meta.blurTrial === true;

  await prisma.galleryItem.update({
    where: { id: itemId },
    data: {
      resultUrl: saved.publicUrl,
      metaJson: JSON.stringify({
        ...meta,
        status: "ready",
        error: undefined,
        orphanHealedAt: undefined,
        orphanReason: undefined,
        recoveredFromComfy: recoveredFrom,
        localKey: saved.relKey,
      }),
    },
  });

  try {
    if (funnelV2 || funnelV2Blur) {
      const { resolveUserTelegramDelivery } = await import(
        "@/lib/tg/notify-user"
      );
      const dest = await resolveUserTelegramDelivery(userId);
      if (dest?.platformUserId) {
        const { enqueueFunnelV2Result } = await import(
          "@/lib/tg/funnel-v2/enqueue-result"
        );
        await enqueueFunnelV2Result({
          userId,
          platformUserId: dest.platformUserId,
          locale: "ru",
          kind: "photo",
          url: saved.publicUrl,
          galleryItemId: itemId,
          successKind: funnelV2Blur ? "funnel_v2_blur" : "funnel_v2_photo",
          blurTrial: funnelV2Blur,
          offerQcDislike: funnelV2 && !funnelV2Blur,
          extraPayload: {
            chargedPeaches: Number(meta.chargedPeaches || 0) || 0,
            recovered: true,
          },
        });
      }
    } else {
      const { notifyTelegramMediaReady } = await import("@/lib/tg/tg-notify");
      await notifyTelegramMediaReady({
        userId,
        kind: "photo",
        mediaUrl: saved.publicUrl,
        caption: "Готово",
        galleryItemId: itemId,
      });
    }
  } catch (e) {
    console.error(
      "[peach] gallery-photo recover notify:",
      e instanceof Error ? e.message : e,
    );
  }

  console.log(
    `[peach] recovered gallery photo ${itemId} from Comfy (${recoveredFrom})`,
  );
  return true;
}

/**
 * If Comfy finished (history by promptId) but Railway lost the waiter,
 * pull the image and mark the gallery item ready — no re-render.
 */
export async function tryRecoverGalleryItemFromComfy(
  itemId: string,
): Promise<boolean> {
  const item = await prisma.galleryItem.findUnique({ where: { id: itemId } });
  if (!item?.userId) return false;
  const meta = parseMeta(item.metaJson);
  if (meta.status === "ready") return true;
  if (meta.status !== "pending" && meta.status !== "busy") return false;
  if (!isPhotoHealEngine(meta) && item.kind !== "photo") return false;

  const job = await prisma.gpuJob.findFirst({
    where: { refType: "galleryItem", refId: itemId },
    orderBy: { queuedAt: "desc" },
    include: { worker: { select: { comfyUrl: true } } },
  });
  const jobMeta = parseMeta(job?.metaJson);
  const promptId =
    typeof jobMeta.comfyPromptId === "string" ? jobMeta.comfyPromptId : "";

  const {
    listComfyBases,
    comfyDownloadFromBase,
    comfyHistoryOutputFiles,
    ensureComfyReady,
  } = await import("@/lib/comfy-client");

  try {
    await ensureComfyReady(8, 1000);
  } catch {
    return false;
  }

  const bases: string[] = [];
  const pushBase = (u: unknown) => {
    const s = typeof u === "string" ? u.trim().replace(/\/$/, "") : "";
    if (s && !bases.includes(s)) bases.push(s);
  };
  pushBase(jobMeta.comfyBase);
  pushBase(job?.worker?.comfyUrl);
  for (const b of listComfyBases()) pushBase(b);

  if (promptId) {
    for (const base of bases) {
      const files = await comfyHistoryOutputFiles(base, promptId);
      const image =
        files.find((f) => /\.(png|jpg|jpeg|webp)$/i.test(f.filename)) ||
        files[0];
      if (!image) continue;
      try {
        const buf = await comfyDownloadFromBase(base, image);
        if (buf?.length && buf.length > 100) {
          // Funnel blur trial: apply tease if needed and not already applied.
          let out = buf;
          if (meta.blurTrial === true && !meta.recoveredBlurApplied) {
            try {
              const { applyTeaseFromLabPreset } = await import(
                "@/lib/tease-overlay-apply"
              );
              out = await applyTeaseFromLabPreset(buf);
              meta.recoveredBlurApplied = true;
            } catch {
              /* deliver clear if tease fails */
            }
          }
          return deliverRecoveredPhoto({
            itemId,
            userId: item.userId,
            bytes: out,
            meta,
            recoveredFrom: `history:${promptId}/${image.filename}`,
          });
        }
      } catch {
        /* next base */
      }
    }
  }

  // Filename fallback only when prefix is unique to this item (contains id).
  const prefix =
    typeof meta.comfyFilenamePrefix === "string"
      ? meta.comfyFilenamePrefix
      : typeof jobMeta.comfyFilenamePrefix === "string"
        ? jobMeta.comfyFilenamePrefix
        : "";
  if (prefix && prefix.includes(itemId)) {
    const leaf = prefix.replace(/^peach\//, "");
    const names = [
      `${leaf}_00001_.png`,
      `${leaf}_00002_.png`,
      `${leaf}_00001_.jpg`,
      `${leaf}.png`,
    ];
    for (const base of bases) {
      for (const filename of names) {
        try {
          const buf = await comfyDownloadFromBase(base, {
            filename,
            subfolder: "peach",
            type: "output",
          });
          if (buf?.length && buf.length > 100) {
            return deliverRecoveredPhoto({
              itemId,
              userId: item.userId,
              bytes: buf,
              meta,
              recoveredFrom: `file:${filename}`,
            });
          }
        } catch {
          /* try next */
        }
      }
    }
  }

  return false;
}

/**
 * One-shot re-render after recover miss (no extra charge). Needs saved source.
 */
export async function requeueGalleryPhotoAfterHeal(
  itemId: string,
): Promise<boolean> {
  const item = await prisma.galleryItem.findUnique({ where: { id: itemId } });
  if (!item?.userId) return false;
  const meta = parseMeta(item.metaJson);
  if (meta.status === "ready") return false;
  if (!isPhotoHealEngine(meta)) return false;

  const source = loadSourceBytes(meta, item.sourceUrl);
  if (!source?.length) {
    console.warn(
      `[peach] gallery-photo requeue skip ${itemId} — no source bytes`,
    );
    return false;
  }

  const userId = item.userId;
  const prefix =
    typeof meta.comfyFilenamePrefix === "string" && meta.comfyFilenamePrefix
      ? meta.comfyFilenamePrefix
      : `peach/undress_${itemId}`;

  await prisma.galleryItem.update({
    where: { id: itemId },
    data: {
      resultUrl: GALLERY_PLACEHOLDER_URL,
      metaJson: JSON.stringify({
        ...meta,
        status: "pending",
        error: undefined,
        orphanHealedAt: undefined,
        orphanReason: undefined,
        healRequeuedAt: new Date().toISOString(),
      }),
    },
  });

  const isUndress =
    meta.undress === true ||
    String(meta.engine || "").includes("undress") ||
    meta.source === "tg_undress" ||
    meta.engine === "krea2_undress";

  void enqueueGpuJob(
    async () => {
      const { useComfy } = await import("@/lib/metalnode-config");
      let bytes: Buffer;
      if (!useComfy()) {
        bytes = source;
      } else if (isUndress) {
        const { runUndressBytes } = await import("@/lib/tg/undress-comfy");
        bytes = await runUndressBytes(source, { filenamePrefix: prefix });
      } else {
        const { runPhotoEditLabBytes } = await import("@/lib/photo-edit-lab");
        const prompt =
          item.editPrompt ||
          item.prompt ||
          (typeof meta.editPrompt === "string" ? meta.editPrompt : "");
        bytes = await runPhotoEditLabBytes({
          photoBytes: source,
          editPrompt: String(prompt || "edit"),
          filenamePrefix: prefix,
        });
      }

      if (meta.blurTrial === true) {
        try {
          const { applyTeaseFromLabPreset } = await import(
            "@/lib/tease-overlay-apply"
          );
          bytes = await applyTeaseFromLabPreset(bytes);
        } catch {
          /* keep clear */
        }
      }

      const saved = saveGalleryBinary(userId, "png", bytes, `heal_rq_${itemId}`);
      const prev = parseMeta(
        (
          await prisma.galleryItem.findUnique({
            where: { id: itemId },
            select: { metaJson: true },
          })
        )?.metaJson,
      );
      await prisma.galleryItem.update({
        where: { id: itemId },
        data: {
          resultUrl: saved.publicUrl,
          metaJson: JSON.stringify({
            ...prev,
            status: "ready",
            error: undefined,
            localKey: saved.relKey,
            healRequeuedDoneAt: new Date().toISOString(),
          }),
        },
      });

      const funnelV2 = prev.funnelV2 === true || prev.source === "funnel_v2";
      const funnelV2Blur = prev.blurTrial === true;
      if (funnelV2 || funnelV2Blur) {
        const { resolveUserTelegramDelivery } = await import(
          "@/lib/tg/notify-user"
        );
        const dest = await resolveUserTelegramDelivery(userId);
        if (dest?.platformUserId) {
          const { enqueueFunnelV2Result } = await import(
            "@/lib/tg/funnel-v2/enqueue-result"
          );
          await enqueueFunnelV2Result({
            userId,
            platformUserId: dest.platformUserId,
            locale: "ru",
            kind: "photo",
            url: saved.publicUrl,
            galleryItemId: itemId,
            successKind: funnelV2Blur ? "funnel_v2_blur" : "funnel_v2_photo",
            blurTrial: funnelV2Blur,
            offerQcDislike: funnelV2 && !funnelV2Blur,
          });
        }
      } else {
        const { notifyTelegramMediaReady } = await import("@/lib/tg/tg-notify");
        await notifyTelegramMediaReady({
          userId,
          kind: "photo",
          mediaUrl: saved.publicUrl,
          caption: item.title || "Готово",
          galleryItemId: itemId,
        });
      }
    },
    {
      userId,
      kind: isUndress ? "photo_undress" : "photo",
      title: `heal-requeue ${itemId}`,
      refType: "galleryItem",
      refId: itemId,
      pool: "photo",
      providers: isUndress ? ["metalnode"] : undefined,
      meta: {
        healRequeue: true,
        undress: isUndress,
        comfyFilenamePrefix: prefix,
      },
    },
  );

  console.log(`[peach] healer requeued gallery photo ${itemId}`);
  return true;
}
