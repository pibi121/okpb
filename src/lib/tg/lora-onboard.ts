import { prisma } from "@/lib/db";
import {
  listCharacterPhotos,
  readTrainMeta,
  restoreTrainingPhotos,
  writeTrainMeta,
} from "@/lib/character-dataset";
import { useComfy } from "@/lib/metalnode-config";
import { loraTrainPeaches } from "@/lib/tg-pricing";
import { debitPeaches, getBalancePeaches, creditPeaches } from "@/lib/tg/wallet";
import {
  grantLoraWelcomePhotos,
  loraBonusActive,
} from "@/lib/tg/tg-promo";
import { enqueueTgOutbox } from "@/lib/tg/session";
import type { TgLocale } from "@/lib/tg/i18n";
import { t, tFormat } from "@/lib/tg/i18n";
import { tgSendMessage } from "@/lib/tg/telegram-api";
import { GEN_CB, OB_CB } from "@/lib/tg/generation-flow";
import { tgMiniAppUrl } from "@/lib/tg/miniapp-url";
import { TG_MIN_LORA_PHOTOS } from "@/lib/tg/character-service";
import { isMockCharacterLora, hasRealCharacterLora } from "@/lib/tg/studio-cast";

export type StartLoraTrainResult =
  | { ok: true; resumed?: boolean; freeRetry?: boolean }
  | {
      ok: false;
      error:
        | "not_found"
        | "already"
        | "need_photos"
        | "insufficient"
        | "debit_failed"
        | "train_start_failed";
      price?: number;
      balance?: number;
      need?: number;
      photoCount?: number;
      detail?: string;
    };

async function resolvePlatformUserId(
  userId: string,
  platformUserId?: string,
): Promise<string> {
  if (platformUserId) return platformUserId;
  return (
    (
      await prisma.platformAccount.findFirst({
        where: { userId, platform: "telegram" },
        select: { platformUserId: true },
      })
    )?.platformUserId || ""
  );
}

async function kickGpuTrain(opts: {
  userId: string;
  characterId: string;
  locale: TgLocale;
  platformUserId?: string;
}): Promise<StartLoraTrainResult> {
  const platformUserId = await resolvePlatformUserId(
    opts.userId,
    opts.platformUserId,
  );
  if (!useComfy()) {
    await completeLoraTrainingMock({
      userId: opts.userId,
      platformUserId,
      characterId: opts.characterId,
      locale: opts.locale,
    });
    return { ok: true };
  }
  try {
    const { startKreaLoraTrain } = await import("@/lib/krea-lora-train");
    await startKreaLoraTrain({
      userId: opts.userId,
      characterId: opts.characterId,
    });
    return { ok: true };
  } catch (e) {
    console.error("[tg] lora train start failed:", e);
    return {
      ok: false,
      error: "train_start_failed",
      detail: e instanceof Error ? e.message : String(e),
    };
  }
}

/** Core LoRA train start — bot + Mini App. */
export async function startLoraTrainingForUser(opts: {
  userId: string;
  characterId: string;
  locale: TgLocale;
  /** Telegram chat for immediate messages; if omitted, notify via outbox when ready. */
  chatId?: number;
  platformUserId?: string;
}): Promise<StartLoraTrainResult> {
  const ch = await prisma.character.findFirst({
    where: { id: opts.characterId, userId: opts.userId, videoRefOnly: false },
  });
  if (!ch) return { ok: false, error: "not_found" };

  // "Ready" but no real GPU LoRA (mock:// or empty path) — free real retrain.
  if (ch.loraStatus === "lora_ready" && !hasRealCharacterLora(ch)) {
    if (listCharacterPhotos(opts.characterId).length < TG_MIN_LORA_PHOTOS) {
      restoreTrainingPhotos(opts.characterId);
    }
    const mockPhotos = listCharacterPhotos(opts.characterId);
    if (mockPhotos.length < TG_MIN_LORA_PHOTOS) {
      return {
        ok: false,
        error: "need_photos",
        need: TG_MIN_LORA_PHOTOS - mockPhotos.length,
        photoCount: mockPhotos.length,
      };
    }
    await prisma.character.update({
      where: { id: opts.characterId },
      data: {
        loraStatus: "lora_training",
        loraPath: null,
        photoCount: mockPhotos.length,
      },
    });
    writeTrainMeta(opts.characterId, {
      ...readTrainMeta(opts.characterId),
      status: "idle",
      error: undefined,
      tgNotify: true,
      tgNotified: false,
      finishedAt: undefined,
    });
    const kicked = await kickGpuTrain(opts);
    if (!kicked.ok) {
      await prisma.character.update({
        where: { id: opts.characterId },
        data: { loraStatus: "lora_ready", loraPath: ch.loraPath },
      });
      return kicked;
    }
    return { ok: true, freeRetry: true };
  }

  if (ch.loraStatus === "lora_ready") {
    return { ok: false, error: "already" };
  }

  // Stuck/in-progress train: resume or restart on GPU without charging again.
  if (ch.loraStatus === "lora_training") {
    const kicked = await kickGpuTrain(opts);
    return kicked.ok ? { ok: true, resumed: true } : kicked;
  }

  if (listCharacterPhotos(opts.characterId).length < TG_MIN_LORA_PHOTOS) {
    restoreTrainingPhotos(opts.characterId);
  }
  const photos = listCharacterPhotos(opts.characterId);
  if (photos.length < TG_MIN_LORA_PHOTOS) {
    return {
      ok: false,
      error: "need_photos",
      need: TG_MIN_LORA_PHOTOS - photos.length,
      photoCount: photos.length,
    };
  }

  const price = loraTrainPeaches();
  const bal = await getBalancePeaches(opts.userId);
  if (bal < price) {
    if (opts.chatId) {
      await tgSendMessage(
        opts.chatId,
        tFormat("onboard_lora_price", opts.locale, { price, balance: bal }),
        {
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: t("onboard_lora_pay_train_btn", opts.locale),
                  callback_data: OB_CB.payTrain(opts.characterId),
                },
              ],
              [{ text: t("topup_btn", opts.locale), callback_data: "tu:open" }],
            ],
          },
        },
      );
    }
    return { ok: false, error: "insufficient", price, balance: bal };
  }

  const paid = await debitPeaches(opts.userId, price, "tg_lora_train", {
    characterId: opts.characterId,
  });
  if (!paid.ok) return { ok: false, error: "debit_failed", price, balance: bal };

  const user = await prisma.user.findUnique({ where: { id: opts.userId } });
  if (user && loraBonusActive(user.tgLoraBonusExpiresAt)) {
    await grantLoraWelcomePhotos(opts.userId);
  }

  await prisma.character.update({
    where: { id: opts.characterId },
    data: { loraStatus: "lora_training" },
  });

  const prevMeta = readTrainMeta(opts.characterId);
  writeTrainMeta(opts.characterId, {
    ...prevMeta,
    tgNotify: true,
    tgNotified: false,
  });

  if (opts.chatId) {
    await tgSendMessage(
      opts.chatId,
      tFormat("onboard_lora_started", opts.locale, { price }),
      {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: t("gen_video_now_btn", opts.locale),
                callback_data: GEN_CB.againVideo,
              },
            ],
          ],
        },
      },
    );
  }

  const platformUserId = await resolvePlatformUserId(
    opts.userId,
    opts.platformUserId,
  );

  const kicked = await kickGpuTrain({
    userId: opts.userId,
    characterId: opts.characterId,
    locale: opts.locale,
    platformUserId,
  });
  if (!kicked.ok) {
    await creditPeaches(opts.userId, price, "tg_lora_train_refund", {
      characterId: opts.characterId,
    });
    writeTrainMeta(opts.characterId, {
      ...readTrainMeta(opts.characterId),
      status: "error",
      error: kicked.detail || "train_start_failed",
      phase: "Ошибка старта",
      finishedAt: new Date().toISOString(),
    });
    await prisma.character.update({
      where: { id: opts.characterId },
      data: { loraStatus: "lookbook_ready" },
    });
    return kicked;
  }

  return { ok: true };
}

/** Bot wrapper — returns true when training started. */
export async function tryStartLoraTraining(opts: {
  chatId: number;
  platformUserId: string;
  userId: string;
  locale: TgLocale;
  characterId: string;
}): Promise<boolean> {
  const r = await startLoraTrainingForUser(opts);
  return r.ok;
}

/** Notify TG user when LoRA training completes (GPU or mock). Idempotent via train meta. */
export async function notifyTgLoraTrainingComplete(characterId: string): Promise<void> {
  const meta = readTrainMeta(characterId);
  if (!meta.tgNotify || meta.tgNotified) return;

  const ch = await prisma.character.findUnique({ where: { id: characterId } });
  if (!ch || ch.loraStatus !== "lora_ready") return;

  const acc = await prisma.platformAccount.findFirst({
    where: { userId: ch.userId, platform: "telegram" },
    include: { user: true },
  });
  if (!acc) return;

  const locale = acc.user.locale?.startsWith("en") ? "en" : "ru";
  let body = tFormat("onboard_lora_ready", locale, { name: ch.name });
  if ((acc.user.tgLoraWelcomePhotosLeft ?? 0) > 0) {
    body += t("onboard_lora_welcome_bonus", locale);
  }

  await enqueueTgOutbox({
    platformUserId: acc.platformUserId,
    userId: ch.userId,
    kind: "text",
    payload: {
      text: body,
      reply_markup: {
        inline_keyboard: [
          [{ text: t("gen_lora_photo_btn", locale), callback_data: GEN_CB.againPhoto }],
          [
            {
              text: t("marketplace_btn", locale),
              web_app: { url: tgMiniAppUrl("characters") },
            },
          ],
        ],
      },
    },
  });

  writeTrainMeta(characterId, { ...meta, tgNotified: true });
}

export async function completeLoraTrainingMock(opts: {
  userId: string;
  platformUserId: string;
  characterId: string;
  locale: TgLocale;
}) {
  const trigger = `tg_${opts.characterId.slice(0, 8)}`;
  await prisma.character.update({
    where: { id: opts.characterId },
    data: {
      loraStatus: "lora_ready",
      triggerWord: trigger,
      // Mark mock so hasRealCharacterLora stays false until GPU path writes a real file.
      loraPath: `mock://${trigger}`,
    },
  });
  await notifyTgLoraTrainingComplete(opts.characterId);
}
