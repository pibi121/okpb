import { prisma } from "@/lib/db";
import fs from "node:fs";
import { assertUserCanUseBot } from "@/lib/ops/gate";
import {
  getQuickVideoTemplateDetail,
  userOwnsTemplate,
} from "@/lib/quick-video-template";
import {
  parseQuickVideoShotsPlan,
  type QuickVideoShotsPlan,
} from "@/lib/quick-video-prompt";
import {
  startQuickVideoRun,
  type ManualPictureSlotInput,
} from "@/lib/quick-video";
import { enqueuePhotoJob, enqueueGpuJob } from "@/lib/gallery-jobs";
import {
  generatePhotoBytes,
  localBytesFromResultUrl,
  runI2VFromStill,
} from "@/lib/peach-lab";
import { useComfy } from "@/lib/metalnode-config";
import { GALLERY_PLACEHOLDER_URL } from "@/lib/gallery-meta";
import { saveGalleryBinary } from "@/lib/local-store";
import { kreaStillSize } from "@/lib/video-orientation";
import {
  applyFirstVideoDiscount,
} from "@/lib/tg-pricing";
import { getPhotoTemplate } from "@/lib/photo-template";
import { debitPeaches } from "@/lib/tg/wallet";
import { enqueueTgOutbox } from "@/lib/tg/session";
import {
  characterReadyForVideo,
} from "@/lib/tg/character-service";
import {
  isStudioCastCharacter,
  characterUsesLoraPhoto,
} from "@/lib/tg/studio-cast";
import {
  canUseStudioDailyFree,
  consumeLoraWelcomePhoto,
  consumeStudioDailyFree,
} from "@/lib/tg/tg-promo";

import {
  applySpeechFills,
  applySpeechFillsToShotsJson,
  normalizeFills,
  type SpeechSlotFill,
} from "@/lib/speech-slots";
import { resolveVideoTemplateSpeech } from "@/lib/tg/template-speech";

async function assertGenerationOpen(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { locale: true },
  });
  const gate = await assertUserCanUseBot(userId, user?.locale);
  if (!gate.ok) throw new Error(gate.message);
}

function injectSpeech(plan: QuickVideoShotsPlan, line: string): QuickVideoShotsPlan {
  const text = line.trim().slice(0, 500);
  if (!text || !plan.shots.length) return plan;
  const shots = [...plan.shots];
  const first = { ...shots[0]! };
  const tag = `voiceover: "${text.replace(/"/g, "'")}"`;
  first.legoQuery = first.legoQuery?.includes("voiceover:")
    ? first.legoQuery
    : `${first.legoQuery || ""} ${tag}`.trim();
  shots[0] = first;
  return { ...plan, shots };
}

export type TgGenerateResult = {
  runId?: string;
  galleryItemId?: string;
  chargedPeaches: number;
  discountApplied?: boolean;
  freePhoto?: boolean;
};

export async function resolveTemplatePricePeaches(opts: {
  kind: "video" | "photo";
  templateId: string;
  userId: string;
  tier?: "basic" | "pose";
  /** When set, photo price splits actress vs own LoRA. */
  characterId?: string;
}): Promise<number> {
  if (opts.kind === "photo") {
    const row = await getPhotoTemplate(opts.templateId);
    if (!row) throw new Error("template not found");
    const {
      priceForPhotoCharacter,
      priceForPhotoTemplateTier,
    } = await import("@/lib/template-pricing");
    if (opts.characterId) {
      const ch = await prisma.character.findFirst({
        where: { id: opts.characterId },
        select: { isStudioCast: true, loraStatus: true, userId: true },
      });
      if (ch) {
        const useLora =
          !isStudioCastCharacter(ch) && characterUsesLoraPhoto(ch);
        return priceForPhotoCharacter({ isStudioCast: !useLora });
      }
    }
    const useLora = opts.tier === "pose" || row.tier === "pose";
    return priceForPhotoTemplateTier(useLora ? "pose" : "basic");
  }

  const loraI2v = await prisma.loraI2vTemplate.findFirst({
    where: { id: opts.templateId, tgPublished: true },
    select: { durationSec: true },
  });
  if (loraI2v) {
    const { priceForLoraI2vTemplate } = await import("@/lib/template-pricing");
    return priceForLoraI2vTemplate(loraI2v.durationSec || 6);
  }

  const detail = await getQuickVideoTemplateDetail(opts.userId, opts.templateId);
  if (!detail) throw new Error("template not found");
  const { priceForQuickVideoTemplate } = await import("@/lib/template-pricing");
  return priceForQuickVideoTemplate({
    shotsJson: detail.shotsJson,
    durationSec: detail.durationSec,
  });
}

export async function startTgLoraI2vGeneration(opts: {
  userId: string;
  platformUserId: string;
  templateId: string;
  characterId: string;
  speechLine?: string;
  speechFills?: SpeechSlotFill[];
}): Promise<TgGenerateResult> {
  await assertGenerationOpen(opts.userId);
  const tpl = await prisma.loraI2vTemplate.findFirst({
    where: { id: opts.templateId, tgPublished: true },
  });
  if (!tpl) throw new Error("Шаблон не найден");

  const { slots } = await resolveVideoTemplateSpeech(opts.templateId);
  let fills = normalizeFills(slots, opts.speechFills);
  if (!fills.length && opts.speechLine?.trim()) {
    fills = [{ id: "s1", text: opts.speechLine.trim(), lang: "en" }];
  }
  const i2vPrompt = slots.length
    ? applySpeechFills(tpl.i2vPrompt, slots, fills)
    : opts.speechLine?.trim()
      ? `${tpl.i2vPrompt}\n\nSpoken dialogue (perform clearly): "${opts.speechLine.trim().replace(/"/g, "'")}"`
      : tpl.i2vPrompt;

  const character = await prisma.character.findFirst({
    where: {
      id: opts.characterId,
      OR: [{ userId: opts.userId }, { isStudioCast: true }],
    },
  });
  if (!character) throw new Error("Персонаж не найден");
  if (!isStudioCastCharacter(character)) {
    const { assertCharacterPhotosAllowed } = await import("@/lib/age-gate");
    await assertCharacterPhotosAllowed(character.id, "ru");
  }
  if (character.loraStatus !== "lora_ready" || !character.triggerWord?.trim()) {
    throw new Error("Для этого шаблона нужна обученная модель");
  }
  const loraPath = character.loraPath || "";
  if (loraPath.startsWith("mock://") && character.triggerWord !== "olh_person") {
    throw new Error("Модель ещё не готова — подожди или запусти подготовку снова");
  }

  const user = await prisma.user.findUnique({ where: { id: opts.userId } });
  if (!user) throw new Error("user not found");

  const { priceForLoraI2vTemplate } = await import("@/lib/template-pricing");
  let price = priceForLoraI2vTemplate(tpl.durationSec || 6);
  const discounted = applyFirstVideoDiscount(
    price,
    user.tgFirstVideoDiscountUsed,
  );
  price = discounted.peaches;

  if (price > 0) {
    const paid = await debitPeaches(opts.userId, price, "tg_video", {
      templateId: opts.templateId,
      kind: "lora_i2v",
    });
    if (!paid.ok) {
      throw new Error(
        `Недостаточно персиков (нужно ${price}, есть ${paid.balance})`,
      );
    }
  }
  if (discounted.discountApplied) {
    await prisma.user.update({
      where: { id: opts.userId },
      data: { tgFirstVideoDiscountUsed: true },
    });
  }

  const title = tpl.tgDisplayTitle.trim() || tpl.title;
  const item = await prisma.galleryItem.create({
    data: {
      userId: opts.userId,
      characterId: character.id,
      kind: "video",
      title,
      prompt: i2vPrompt,
      resultUrl: GALLERY_PLACEHOLDER_URL,
      metaJson: JSON.stringify({
        status: "pending",
        jobAction: "lora_i2v",
        loraI2vTemplateId: tpl.id,
        stillPrompt: tpl.stillPrompt,
        durationSec: tpl.durationSec,
      }),
    },
  });

  void enqueueLoraI2vJob({
    itemId: item.id,
    userId: opts.userId,
    title,
    i2vPrompt,
    speechFills: fills,
    tpl,
    character,
  });

  return {
    galleryItemId: item.id,
    chargedPeaches: price,
    discountApplied: discounted.discountApplied,
  };
}

/** Resume pending/error lora_i2v gallery item without charging again. */
export async function resumePendingLoraI2vGalleryItem(opts: {
  galleryItemId: string;
  userId: string;
  platformUserId?: string;
  templateId: string;
  characterId: string;
}) {
  const active = await prisma.gpuJob.findFirst({
    where: {
      refType: "galleryItem",
      refId: opts.galleryItemId,
      status: { in: ["queued", "assigned", "running"] },
    },
    select: { id: true, status: true },
  });
  if (active) {
    console.warn(
      `[peach] skip resume lora_i2v ${opts.galleryItemId}: already ${active.status} (${active.id})`,
    );
    return { galleryItemId: opts.galleryItemId, skipped: true as const };
  }

  const tpl = await prisma.loraI2vTemplate.findFirst({
    where: { id: opts.templateId, tgPublished: true },
  });
  if (!tpl) throw new Error("Шаблон не найден");

  const character = await prisma.character.findFirst({
    where: {
      id: opts.characterId,
      OR: [{ userId: opts.userId }, { isStudioCast: true }],
    },
  });
  if (!character) throw new Error("Персонаж не найден");
  if (character.loraStatus !== "lora_ready" || !character.triggerWord?.trim()) {
    throw new Error("Для этого шаблона нужна обученная модель");
  }

  const { slots } = await resolveVideoTemplateSpeech(opts.templateId);
  const i2vPrompt = slots.length
    ? applySpeechFills(tpl.i2vPrompt, slots, [])
    : tpl.i2vPrompt;
  const title = tpl.tgDisplayTitle.trim() || tpl.title;

  await prisma.galleryItem.update({
    where: { id: opts.galleryItemId },
    data: {
      title,
      prompt: i2vPrompt,
      resultUrl: GALLERY_PLACEHOLDER_URL,
      metaJson: JSON.stringify({
        status: "pending",
        jobAction: "lora_i2v",
        loraI2vTemplateId: tpl.id,
        stillPrompt: tpl.stillPrompt,
        durationSec: tpl.durationSec,
        resumedAt: new Date().toISOString(),
      }),
    },
  });

  void enqueueLoraI2vJob({
    itemId: opts.galleryItemId,
    userId: opts.userId,
    title,
    i2vPrompt,
    speechFills: [],
    tpl,
    character,
  });

  return { galleryItemId: opts.galleryItemId, skipped: false as const };
}

/** Resume pending lora_i2v gallery items after process restart (no re-charge). */
export async function resumePendingLoraI2vJobs() {
  const since = new Date(Date.now() - 6 * 60 * 60 * 1000);
  const items = await prisma.galleryItem.findMany({
    where: {
      kind: "video",
      createdAt: { gte: since },
      resultUrl: GALLERY_PLACEHOLDER_URL,
    },
    orderBy: { createdAt: "asc" },
    take: 20,
  });
  let n = 0;
  for (const item of items) {
    let meta: Record<string, unknown> = {};
    try {
      meta = JSON.parse(item.metaJson || "{}") as Record<string, unknown>;
    } catch {
      continue;
    }
    if (meta.jobAction !== "lora_i2v") continue;
    if (meta.status && meta.status !== "pending") continue;
    const templateId = String(meta.loraI2vTemplateId || "");
    const characterId = String(item.characterId || "");
    if (!templateId || !characterId) continue;
    try {
      await resumePendingLoraI2vGalleryItem({
        galleryItemId: item.id,
        userId: item.userId,
        templateId,
        characterId,
      });
      n += 1;
    } catch (e) {
      console.error(
        `[peach] resume lora_i2v ${item.id} failed:`,
        e instanceof Error ? e.message : e,
      );
    }
  }
  return n;
}

function enqueueLoraI2vJob(opts: {
  itemId: string;
  userId: string;
  title: string;
  i2vPrompt: string;
  speechFills?: SpeechSlotFill[];
  tpl: {
    id: string;
    stillPrompt: string;
    negativePrompt: string | null;
    orientation: string | null;
    durationSec: number | null;
    previewVideoUrl: string | null;
    shotsJson?: string | null;
    i2vPrompt?: string | null;
  };
  character: {
    id: string;
    triggerWord: string | null;
  };
}) {
  const { itemId, userId, title, i2vPrompt, tpl, character } = opts;
  const speechFills = opts.speechFills || [];
  void enqueueGpuJob(
    async () => {
    try {
      if (!useComfy()) {
        const previewUrl =
          tpl.previewVideoUrl || "/tg/catalog/video-1.mp4";
        const bytes =
          localBytesFromResultUrl(previewUrl) ||
          localBytesFromResultUrl("/tg/catalog/video-1.mp4");
        if (!bytes?.length) throw new Error("mock preview missing");
        const saved = saveGalleryBinary(
          userId,
          "mp4",
          bytes,
          `tg_li2v_${itemId}`,
        );
        await prisma.galleryItem.update({
          where: { id: itemId },
          data: {
            resultUrl: saved.publicUrl,
            metaJson: JSON.stringify({
              status: "ready",
              engine: "mock",
              jobAction: "lora_i2v",
              loraI2vTemplateId: tpl.id,
            }),
          },
        });
        await notifyTgVideoReady(userId, saved.publicUrl, title);
        return;
      }

      const { resolveLoraI2vShots } = await import("@/lib/lora-i2v-shots");
      const { applySpeechFills: applyFills } = await import("@/lib/speech-slots");
      const { resolveVideoTemplateSpeech } = await import(
        "@/lib/tg/template-speech"
      );
      const { slots } = await resolveVideoTemplateSpeech(tpl.id);
      const shots = resolveLoraI2vShots({
        shotsJson: tpl.shotsJson,
        stillPrompt: tpl.stillPrompt,
        i2vPrompt: tpl.i2vPrompt || i2vPrompt,
        negativePrompt: tpl.negativePrompt,
        durationSec: tpl.durationSec,
      });
      if (!shots.length) throw new Error("В шаблоне нет шотов");

      const trigger = character.triggerWord!.trim();
      const orient = (tpl.orientation || "9_16") as "9_16" | "16_9" | "1_1";
      const size = kreaStillSize(orient);
      const clipBuffers: Buffer[] = [];
      const clipPaths: string[] = [];
      const tmpCleanup: string[] = [];
      let lastWidth = size.width;
      let lastHeight = size.height;
      let engine = "minimax_h3";

      try {
        for (let i = 0; i < shots.length; i++) {
          const shot = shots[i]!;
          let composed = shot.stillPrompt.trim();
          const re = new RegExp(
            `\\b${trigger.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
            "i",
          );
          if (!re.test(composed)) composed = `${trigger}, ${composed}`;

          const motion =
            shots.length === 1
              ? i2vPrompt
              : slots.length > 0
                ? applyFills(shot.i2vPrompt, slots, speechFills)
                : shot.i2vPrompt;

          let still;
          let clip;
          let lastShotErr: unknown;
          for (let attempt = 0; attempt < 2; attempt++) {
            try {
              still = await generatePhotoBytes({
                userId,
                characterId: character.id,
                characterIds: [character.id],
                useCharacterLora: true,
                usePreset: false,
                composedPrompt: composed,
                negativePrompt:
                  shot.negativePrompt || tpl.negativePrompt || undefined,
                title: `${title} · shot ${i + 1}`,
                width: size.width,
                height: size.height,
              });
              clip = await runI2VFromStill({
                stillBytes: still.bytes,
                prompt: motion,
                width: still.width,
                height: still.height,
                filenamePrefix: "peach/li2v",
                durationSec: shot.durationSec || 6,
                extraHints: [shot.stillPrompt, motion, still.prompt],
              });
              if (!clip.bytes?.length || clip.bytes.length < 100) {
                throw new Error(
                  `Шот ${i + 1}: видео не удалось создать — попробуй ещё раз`,
                );
              }
              lastShotErr = null;
              break;
            } catch (e) {
              lastShotErr = e;
              console.warn(
                `[peach] lora_i2v shot ${i + 1} attempt ${attempt + 1} failed:`,
                e instanceof Error ? e.message.slice(0, 200) : e,
              );
              if (attempt === 1) break;
              await new Promise((r) => setTimeout(r, 5000));
            }
          }
          if (lastShotErr || !still || !clip) {
            throw lastShotErr instanceof Error
              ? lastShotErr
              : new Error(`Шот ${i + 1} не удалось создать`);
          }

          lastWidth = still.width;
          lastHeight = still.height;
          engine = clip.engine || engine;

          if (shots.length === 1) {
            const saved = saveGalleryBinary(
              userId,
              "mp4",
              clip.bytes,
              `tg_li2v_${itemId}`,
            );
            await prisma.galleryItem.update({
              where: { id: itemId },
              data: {
                resultUrl: saved.publicUrl,
                width: still.width,
                height: still.height,
                prompt: motion,
                metaJson: JSON.stringify({
                  status: "ready",
                  engine: clip.engine,
                  jobAction: "lora_i2v",
                  loraI2vTemplateId: tpl.id,
                  localKey: saved.relKey,
                  shots: 1,
                }),
              },
            });
            await notifyTgVideoReady(userId, saved.publicUrl, title);
            return;
          }

          clipBuffers.push(Buffer.from(clip.bytes));
          const { ffmpegStitchTempPath } = await import("@/lib/ffmpeg-stitch");
          const tmp = ffmpegStitchTempPath(`tg_li2v_${itemId}_s${i}`);
          fs.writeFileSync(tmp, clip.bytes);
          clipPaths.push(tmp);
          tmpCleanup.push(tmp);
        }

        const { stitchClipBuffersWithFallback } = await import(
          "@/lib/stitch-fallback"
        );
        let stitched: {
          bytes: Buffer;
          width: number;
          height: number;
          engine: string;
        } | null = null;
        let stitchErr: unknown;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            stitched = await stitchClipBuffersWithFallback({
              clips: clipBuffers,
              tag: `tg_li2v_${itemId}`,
              trimStartSec: 0,
            });
            stitchErr = null;
            break;
          } catch (e) {
            stitchErr = e;
            console.warn(
              `[peach] lora_i2v stitch attempt ${attempt + 1}/3:`,
              e instanceof Error ? e.message.slice(0, 240) : e,
            );
            await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
          }
        }
        if (!stitched?.bytes?.length) {
          throw stitchErr instanceof Error
            ? stitchErr
            : new Error("Склейка шотов вернула пустой файл");
        }
        const saved = saveGalleryBinary(
          userId,
          "mp4",
          stitched.bytes,
          `tg_li2v_${itemId}`,
        );
        await prisma.galleryItem.update({
          where: { id: itemId },
          data: {
            resultUrl: saved.publicUrl,
            width: stitched.width || lastWidth,
            height: stitched.height || lastHeight,
            prompt: i2vPrompt,
            metaJson: JSON.stringify({
              status: "ready",
              engine: `${engine}+${stitched.engine}`,
              jobAction: "lora_i2v",
              loraI2vTemplateId: tpl.id,
              localKey: saved.relKey,
              shots: shots.length,
            }),
          },
        });
        await notifyTgVideoReady(userId, saved.publicUrl, title);
      } finally {
        for (const p of tmpCleanup) {
          try {
            if (fs.existsSync(p)) fs.unlinkSync(p);
          } catch {
            /* ignore */
          }
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "ошибка создания видео";
      console.error("[peach] lora_i2v job failed:", e);
      await prisma.galleryItem.update({
        where: { id: itemId },
        data: {
          metaJson: JSON.stringify({
            status: "error",
            error: msg,
            jobAction: "lora_i2v",
            loraI2vTemplateId: tpl.id,
          }),
        },
      });
      const { notifyTelegramGenerationError } = await import("@/lib/tg/tg-notify");
      await notifyTelegramGenerationError(userId, msg).catch(() => undefined);
      void import("@/lib/gpu/orchestrator")
        .then(async ({ noteGpuJobError, currentGpuJobId }) => {
          if (currentGpuJobId()) {
            await noteGpuJobError(msg, { itemId, jobAction: "lora_i2v" });
            return;
          }
          const { reportOpsError } = await import("@/lib/ops/errors");
          await reportOpsError({
            kind: "generation",
            message: msg,
            userId,
            stage: "error",
            refType: "galleryItem",
            refId: itemId,
            meta: { jobAction: "lora_i2v", templateId: tpl.id },
          });
        })
        .catch(() => undefined);
    }
  },
    {
      kind: "lora_i2v",
      pool: "video",
      userId,
      refType: "galleryItem",
      refId: itemId,
      title,
      meta: { templateId: tpl.id },
    },
  );
}

export async function startTgVideoGeneration(opts: {
  userId: string;
  platformUserId: string;
  templateId: string;
  characterId: string;
  speechLine?: string;
  speechFills?: SpeechSlotFill[];
}): Promise<TgGenerateResult> {
  await assertGenerationOpen(opts.userId);
  const { trackFunnelEventBg } = await import("@/lib/ops/funnel-track");
  trackFunnelEventBg({
    userId: opts.userId,
    platformUserId: opts.platformUserId,
    eventKey: "bot.gen.started",
    meta: { kind: "video", templateId: opts.templateId, characterId: opts.characterId },
  });
  const loraI2v = await prisma.loraI2vTemplate.findFirst({
    where: { id: opts.templateId, tgPublished: true },
  });
  if (loraI2v) {
    return startTgLoraI2vGeneration({
      userId: opts.userId,
      platformUserId: opts.platformUserId,
      templateId: opts.templateId,
      characterId: opts.characterId,
      speechLine: opts.speechLine,
      speechFills: opts.speechFills,
    });
  }

  const detail = await getQuickVideoTemplateDetail(opts.userId, opts.templateId);
  if (!detail) throw new Error("Шаблон не найден");

  const owned = userOwnsTemplate({
    isAuthor: detail.isAuthor,
    isJuice: detail.isJuice,
    priceCredits: detail.priceCredits,
    purchased: detail.owned,
  });
  if (!owned) throw new Error("Сначала купите шаблон");

  if (!characterReadyForVideo(opts.characterId)) {
    throw new Error("Нужно минимум 1 фото модели");
  }

  {
    const ch = await prisma.character.findFirst({ where: { id: opts.characterId } });
    if (ch && !isStudioCastCharacter(ch)) {
      const { assertCharacterPhotosAllowed } = await import("@/lib/age-gate");
      await assertCharacterPhotosAllowed(opts.characterId, "ru");
    }
  }

  let price = await resolveTemplatePricePeaches({
    kind: "video",
    templateId: opts.templateId,
    userId: opts.userId,
  });

  const user = await prisma.user.findUnique({ where: { id: opts.userId } });
  if (!user) throw new Error("user not found");

  const discounted = applyFirstVideoDiscount(
    price,
    user.tgFirstVideoDiscountUsed,
  );
  price = discounted.peaches;

  if (price > 0) {
    const paid = await debitPeaches(opts.userId, price, "tg_video", {
      templateId: opts.templateId,
    });
    if (!paid.ok) {
      throw new Error(`Недостаточно персиков (нужно ${price}, есть ${paid.balance})`);
    }
  }

  if (discounted.discountApplied) {
    await prisma.user.update({
      where: { id: opts.userId },
      data: { tgFirstVideoDiscountUsed: true },
    });
  }

  let shotsPlan = parseQuickVideoShotsPlan(detail.shotsJson);
  const { parseStoryH3Template } = await import("@/lib/story-h3-prompt");
  let storyTpl = !shotsPlan ? parseStoryH3Template(detail.shotsJson) : null;
  if (!shotsPlan && !storyTpl) throw new Error("Битый шаблон (shots)");

  const { slots: speechSlots } = await resolveVideoTemplateSpeech(opts.templateId);
  let speechFills = normalizeFills(speechSlots, opts.speechFills);
  if (!speechFills.length && opts.speechLine?.trim()) {
    speechFills = [
      {
        id: speechSlots[0]?.id || "s1",
        text: opts.speechLine.trim(),
        lang: "ru",
      },
    ];
  }

  const cast = await prisma.character.findFirst({
    where: { id: opts.characterId },
    select: { name: true },
  });
  const tplMeta = await prisma.quickVideoTemplate.findFirst({
    where: { id: opts.templateId },
    select: { userId: true, slotBlueprintJson: true },
  });
  const authorCasts = tplMeta?.userId
    ? await prisma.character.findMany({
        where: { userId: tplMeta.userId },
        select: { name: true },
      })
    : [];
  const foreignNames = [
    ...authorCasts.map((c) => c.name),
    ...detail.slotBlueprint.map((s) => s.label || ""),
  ];

  if (shotsPlan) {
    const { bindQuickVideoShotsToCharacter } = await import(
      "@/lib/quick-video-template"
    );
    let boundJson = bindQuickVideoShotsToCharacter(
      detail.shotsJson,
      cast?.name || "Subject",
      foreignNames,
    );
    let slotsForShots = speechSlots;
    if (!slotsForShots.length) {
      const { extractSpeechSlots } = await import("@/lib/speech-slots");
      const { parseQuickVideoShotsPlan: parsePlan } = await import(
        "@/lib/quick-video-prompt"
      );
      const plan = parsePlan(boundJson);
      const src = (plan?.shots || []).map((s) => s.legoQuery || "").join("\n\n");
      slotsForShots = extractSpeechSlots(src).filter((s) => s.text.trim());
    }
    if (slotsForShots.length) {
      boundJson = applySpeechFillsToShotsJson(
        boundJson,
        slotsForShots,
        speechFills.length
          ? speechFills
          : slotsForShots.map((s) => ({
              id: s.id,
              text: s.text,
              lang: s.lang || "ru",
            })),
      );
    }
    shotsPlan = parseQuickVideoShotsPlan(boundJson) || shotsPlan;

    if (!slotsForShots.length && opts.speechLine?.trim()) {
      shotsPlan = injectSpeech(shotsPlan, opts.speechLine);
    }
  } else if (storyTpl) {
    let slotsForStory = speechSlots.filter((s) => s.text.trim());
    if (!slotsForStory.length) {
      const { extractSpeechSlots } = await import("@/lib/speech-slots");
      slotsForStory = extractSpeechSlots(storyTpl.prompt).filter((s) =>
        s.text.trim(),
      );
    }
    if (slotsForStory.length) {
      const fills = speechFills.length
        ? speechFills
        : slotsForStory.map((s) => ({
            id: s.id,
            text: s.text,
            lang: s.lang || "ru",
          }));
      const prompt = applySpeechFills(storyTpl.prompt, slotsForStory, fills);
      storyTpl = { ...storyTpl, prompt };
    } else if (opts.speechLine?.trim()) {
      storyTpl = {
        ...storyTpl,
        prompt: `${storyTpl.prompt}\n\nSpoken dialogue (perform clearly): "${opts.speechLine.trim().replace(/"/g, "'")}"`,
      };
    }
  }

  const manualSlots: ManualPictureSlotInput[] = [];
  let fallbackPi =
    Math.max(
      1,
      detail.identityPersonCount,
      ...detail.slotBlueprint
        .filter((s) => s.role === "identity")
        .map((s) => s.pictureIndex || 0),
    ) + 1;
  for (const slot of detail.slotBlueprint) {
    if (slot.role === "identity") continue;
    if (!slot.bakedRefUrl) continue;
    const bytes = localBytesFromResultUrl(slot.bakedRefUrl);
    if (!bytes?.length) continue;
    const pictureIndex =
      typeof slot.pictureIndex === "number" && slot.pictureIndex >= 1
        ? slot.pictureIndex
        : fallbackPi++;
    manualSlots.push({
      pictureIndex,
      role: slot.role,
      label: slot.label,
      bytes,
      ext: slot.bakedRefUrl.split(".").pop() || "png",
    });
  }

  let poseVideoBuffer: Buffer | null = null;
  if (detail.refVideoUrl) {
    poseVideoBuffer = localBytesFromResultUrl(detail.refVideoUrl);
  }

  if (!useComfy()) {
    const mock = await mockCompleteVideoRun({
      userId: opts.userId,
      platformUserId: opts.platformUserId,
      title: detail.title,
      characterId: opts.characterId,
      previewVideoUrl: detail.previewVideoUrl || "",
    });
    return {
      runId: mock.runId,
      galleryItemId: mock.galleryItemId,
      chargedPeaches: price,
      discountApplied: discounted.discountApplied,
    };
  }

  const run = await startQuickVideoRun({
    userId: opts.userId,
    title: detail.title,
    shotsPlan: shotsPlan || undefined,
    prompt: storyTpl?.prompt,
    storyH3: Boolean(storyTpl),
    characterIds: [opts.characterId],
    manualSlots: manualSlots.length ? manualSlots : undefined,
    poseVideoBuffer,
    orientation: detail.orientation,
    durationSec: storyTpl?.totalDurationSec || detail.durationSec,
  });

  const linked = await prisma.quickVideoRun.findFirst({
    where: { id: run.id },
    select: { galleryItemId: true },
  });

  return {
    runId: run.id,
    galleryItemId: linked?.galleryItemId ?? undefined,
    chargedPeaches: price,
    discountApplied: discounted.discountApplied,
  };
}

export async function startTgPhotoGeneration(opts: {
  userId: string;
  platformUserId: string;
  templateId: string;
  characterId: string;
  studioDaily?: boolean;
  loraWelcome?: boolean;
}): Promise<TgGenerateResult> {
  await assertGenerationOpen(opts.userId);
  const { trackFunnelEventBg } = await import("@/lib/ops/funnel-track");
  trackFunnelEventBg({
    userId: opts.userId,
    platformUserId: opts.platformUserId,
    eventKey: "bot.gen.started",
    meta: { kind: "photo", templateId: opts.templateId, characterId: opts.characterId },
  });
  const row = await getPhotoTemplate(opts.templateId);
  if (!row) throw new Error("Шаблон не найден");

  const character = await prisma.character.findFirst({
    where: { id: opts.characterId },
  });
  if (!character) throw new Error("Персонаж не найден");

  if (isStudioCastCharacter(character)) {
    // studio cast — no lora required
  } else if (character.loraStatus !== "lora_ready") {
    throw new Error("Для фото со своей моделью нужно завершить обучение");
  } else {
    const { assertCharacterPhotosAllowed } = await import("@/lib/age-gate");
    await assertCharacterPhotosAllowed(character.id, "ru");
  }

  const user = await prisma.user.findUnique({ where: { id: opts.userId } });
  if (!user) throw new Error("user not found");

  const { priceForPhotoCharacter } = await import("@/lib/template-pricing");
  let price = priceForPhotoCharacter({
    isStudioCast: isStudioCastCharacter(character),
  });
  let freePhoto = false;

  if (opts.studioDaily) {
    const ok = await canUseStudioDailyFree(opts.userId);
    if (!ok) throw new Error("Ежедневный бесплатный кадр уже использован");
    price = 0;
    freePhoto = true;
    await consumeStudioDailyFree(opts.userId);
  } else if (opts.loraWelcome) {
    const w = await consumeLoraWelcomePhoto(opts.userId);
    if (!w.used) throw new Error("Подарочные генерации закончились");
    price = 0;
    freePhoto = true;
  } else if (price > 0) {
    const paid = await debitPeaches(opts.userId, price, "tg_photo", {
      templateId: opts.templateId,
    });
    if (!paid.ok) {
      throw new Error(`Недостаточно персиков (нужно ${price}, есть ${paid.balance})`);
    }
  }

  if (!useComfy()) {
    const previewUrl = row.previewImageUrl || row.sceneImageUrl || "/tg/catalog/photo-1.png";
    const previewBytes =
      localBytesFromResultUrl(previewUrl) ||
      localBytesFromResultUrl("/tg/catalog/photo-1.png");
    const mockItem = await prisma.galleryItem.create({
      data: {
        userId: opts.userId,
        characterId: opts.characterId,
        kind: "photo",
        title: row.title,
        prompt: row.editPrompt,
        resultUrl: GALLERY_PLACEHOLDER_URL,
        metaJson: JSON.stringify({ status: "pending", engine: "mock" }),
      },
    });
    const saved = saveGalleryBinary(
      opts.userId,
      "png",
      previewBytes?.length
        ? previewBytes
        : Buffer.from(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z/C/HwAHggJ/PdIqQQAAAABJRU5ErkJggg==",
            "base64",
          ),
      `tg_photo_${mockItem.id}`,
    );
    await prisma.galleryItem.update({
      where: { id: mockItem.id },
      data: {
        resultUrl: saved.publicUrl,
        metaJson: JSON.stringify({ status: "ready", engine: "mock" }),
      },
    });
    await enqueueTgOutbox({
      platformUserId: opts.platformUserId,
      userId: opts.userId,
      kind: "photo",
      payload: {
        url: (await import("@/lib/tg/media-assets")).tgAbsoluteUrl(saved.publicUrl),
        caption: row.title,
        successKind: "photo",
        locale: user.locale?.startsWith("en") ? "en" : "ru",
      },
    });
    return {
      galleryItemId: mockItem.id,
      chargedPeaches: price,
      freePhoto,
    };
  }

  const loraPhoto = characterUsesLoraPhoto(character);

  const { composePhotoTemplatePromptForCharacter } = await import(
    "@/lib/tg/template-prompt"
  );
  const composedPrompt = await composePhotoTemplatePromptForCharacter({
    templateEditPrompt: row.editPrompt,
    characterIds: [opts.characterId],
    // Dual-ref: person image carries identity. LoRA/T2I: inject lookbook+trigger.
    sceneOnly: !loraPhoto,
  });

  const item = await enqueuePhotoJob(opts.userId, {
    userId: opts.userId,
    tgPhotoTemplateId: opts.templateId,
    characterIds: [opts.characterId],
    characterId: opts.characterId,
    composedPrompt,
    useIdentityDualRef: !loraPhoto,
    studioCastLora: loraPhoto,
    title: row.title,
    width: 888,
    height: 1176,
  });

  return {
    galleryItemId: item.id,
    chargedPeaches: price,
    freePhoto,
  };
}

async function mockCompleteVideoRun(opts: {
  userId: string;
  platformUserId: string;
  title: string;
  characterId: string;
  previewVideoUrl?: string;
}) {
  const previewUrl = opts.previewVideoUrl || "/tg/catalog/video-1.mp4";
  const videoBytes =
    localBytesFromResultUrl(previewUrl) ||
    localBytesFromResultUrl("/tg/catalog/video-1.mp4");
  const saved = saveGalleryBinary(
    opts.userId,
    "mp4",
    videoBytes?.length ? videoBytes : Buffer.from("mock"),
    `tg_mock_video_${Date.now()}`,
  );

  const run = await prisma.quickVideoRun.create({
    data: {
      userId: opts.userId,
      title: opts.title,
      prompt: '{"__qvShots":1}',
      composedPrompt: "mock",
      characterIdsJson: JSON.stringify([opts.characterId]),
      refImageUrlsJson: "[]",
      refVideoUrl: "",
      refSlotsJson: "[]",
      resultVideoUrl: saved.publicUrl,
      width: 720,
      height: 1280,
      durationSec: 6,
      orientation: "9_16",
      status: "ready",
      engine: "mock",
    },
  });

  const item = await prisma.galleryItem.create({
    data: {
      userId: opts.userId,
      characterId: opts.characterId,
      kind: "video",
      title: opts.title,
      resultUrl: saved.publicUrl,
      metaJson: JSON.stringify({ status: "ready", engine: "mock" }),
    },
  });

  await prisma.quickVideoRun.update({
    where: { id: run.id },
    data: { galleryItemId: item.id },
  });

  await notifyTgVideoReady(
    opts.userId,
    saved.publicUrl,
    opts.title,
    opts.characterId,
  );

  return { runId: run.id, galleryItemId: item.id };
}

export async function notifyTgPhotoReady(
  userId: string,
  photoUrl: string,
  title: string,
) {
  const { notifyTelegramMediaReady } = await import("@/lib/tg/tg-notify");
  await notifyTelegramMediaReady({
    userId,
    kind: "photo",
    mediaUrl: photoUrl,
    caption: title,
  });
}

export async function notifyTgVideoReady(
  userId: string,
  videoUrl: string,
  title: string,
  characterId?: string,
) {
  let offerSaveCharacterId: string | undefined;
  if (characterId) {
    const ch = await prisma.character.findFirst({
      where: { id: characterId, userId, videoRefOnly: true },
    });
    if (ch && (ch.name === "Модель" || ch.name === "Model")) {
      offerSaveCharacterId = characterId;
    }
  }

  const { notifyTelegramMediaReady } = await import("@/lib/tg/tg-notify");
  await notifyTelegramMediaReady({
    userId,
    kind: "video",
    mediaUrl: videoUrl,
    caption: title,
    offerSaveCharacterId,
  });
}
