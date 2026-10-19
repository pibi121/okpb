/**
 * Funnel v2 Look pack: 5 dual-ref stills as one GPU job, one album.
 * The bot section stays hidden until at least one pack is published.
 */
import { prisma } from "@/lib/db";
import type { TgLocale } from "@/lib/tg/i18n";
import { formatRubOnly } from "@/lib/tg/funnel-v2/money";
import { tgAbsoluteUrl } from "@/lib/tg/media-assets";
import {
  tgAnswerCallbackQuery,
  tgSendMediaGroupFiles,
  tgSendMessage,
  tgSendPhotoFile,
  tgSendVideo,
} from "@/lib/tg/telegram-api";
import { getTgSession, parsePending, setTgSession } from "@/lib/tg/session";
import { FV2 } from "@/lib/tg/funnel-v2/callbacks";
import {
  creditFunnelBalance,
  debitFunnelBalance,
  getFunnelBalance,
} from "@/lib/tg/funnel-v2/mode";
import { funnelV2ReplaceUi } from "@/lib/tg/funnel-v2/ui";
import { saveGalleryBinary } from "@/lib/local-store";
import { GALLERY_PLACEHOLDER_URL } from "@/lib/gallery-meta";

const FRAME_COUNT = 5;

export type LookScene = {
  sceneImageUrl: string;
  editPrompt: string;
};

type PackMeta = {
  lookPack: true;
  lookSettled: boolean;
  lookPackId: string;
  title: string;
  price: number;
  shares: number[];
  frameItemIds: string[];
  platformUserId: string;
  chatId: number;
  locale: TgLocale;
};

export function parseLookScenes(raw: string): LookScene[] {
  try {
    const v = JSON.parse(raw || "[]") as unknown;
    if (!Array.isArray(v)) return [];
    return v.slice(0, FRAME_COUNT).map((row) => {
      const r = row as { sceneImageUrl?: string; editPrompt?: string };
      return {
        sceneImageUrl: String(r.sceneImageUrl || "").trim(),
        editPrompt: String(r.editPrompt || "").trim(),
      };
    });
  } catch {
    return [];
  }
}

export function lookScenesReady(scenes: LookScene[]): boolean {
  return (
    scenes.length === FRAME_COUNT &&
    scenes.every((s) => s.sceneImageUrl.length > 0 && s.editPrompt.length >= 2)
  );
}

export function lookFrameShares(price: number, n = FRAME_COUNT): number[] {
  const total = Math.max(0, Math.floor(price));
  const base = Math.floor(total / n);
  const rem = total - base * n;
  return Array.from({ length: n }, (_, i) => base + (i === n - 1 ? rem : 0));
}

export async function countPublishedLooks(): Promise<number> {
  try {
    return await prisma.funnelLookPack.count({
      where: { funnelV2Published: true },
    });
  } catch (e) {
    console.error("[look-pack] count", e);
    return 0;
  }
}

function buttonTitle(row: { title: string; tgDisplayTitle: string }): string {
  return (row.tgDisplayTitle || row.title).slice(0, 40);
}

export async function sendLookHub(
  chatId: number,
  platformUserId: string,
) {
  const rows = await prisma.funnelLookPack.findMany({
    where: { funnelV2Published: true },
    orderBy: [{ sortOrder: "asc" }, { updatedAt: "desc" }],
    take: 30,
  });
  if (rows.length === 0) {
    await sendFunnelPhotoHub(chatId, platformUserId);
    return;
  }
  const text =
    "<b>Look-образы</b>\n\n" +
    "Один образ — 5 фотографий в разных позах. Пришли своё фото, я сделаю весь набор и пришлю альбомом.";
  const keyboard = {
    inline_keyboard: [
      ...rows.map((row) => [
        {
          text: buttonTitle(row),
          callback_data: FV2.phLook(row.id),
        },
      ]),
      [{ text: "⬅️ К фото", callback_data: FV2.photo }],
    ],
  };
  await funnelV2ReplaceUi(platformUserId, chatId, () =>
    tgSendMessage(chatId, text, { reply_markup: keyboard }),
  );
}

async function sendFunnelPhotoHub(chatId: number, platformUserId: string) {
  const { sendFunnelV2PhotoHub } = await import("@/lib/tg/funnel-v2/photo");
  const session = await getTgSession(platformUserId);
  await sendFunnelV2PhotoHub(
    chatId,
    session?.userId || "",
    platformUserId,
    "ru",
    0,
  );
}

async function sendLookConfirm(
  chatId: number,
  platformUserId: string,
  row: {
    id: string;
    title: string;
    tgDisplayTitle: string;
    notes: string;
    pricePeaches: number;
    previewVideoUrl: string;
  },
) {
  const title = buttonTitle(row);
  const notes = row.notes.trim() ? `${row.notes.trim().slice(0, 400)}\n\n` : "";
  const text =
    `👙 <b>${title}</b>\n\n` +
    notes +
    `5 фотографий одним альбомом.\n` +
    `Стоимость: ${formatRubOnly(row.pricePeaches)}\n\n` +
    `Нажми «Подтвердить», если фото уже загружено.`;
  const kb = {
    inline_keyboard: [
      [
        { text: "Отменить", callback_data: FV2.phLooks, style: "danger" },
        {
          text: "Подтвердить✔️",
          callback_data: FV2.phLookOk(row.id),
          style: "success",
        },
      ],
    ],
  };
  const vid = row.previewVideoUrl.trim();
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
    } catch {
      /* text fallback */
    }
    return (await tgSendMessage(chatId, text, {
      reply_markup: kb,
    })) as { message_id?: number };
  });
}

export async function handleLookPackCallback(opts: {
  chatId: number;
  userId: string;
  platformUserId: string;
  locale: TgLocale;
  data: string;
  callbackId?: string;
}): Promise<boolean> {
  const { chatId, platformUserId, data } = opts;
  if (data === FV2.phLooks) {
    await sendLookHub(chatId, platformUserId);
    return true;
  }
  const open = /^fv2:ph:lk:(.+)$/.exec(data);
  if (open) {
    const row = await prisma.funnelLookPack.findFirst({
      where: { id: open[1], funnelV2Published: true },
    });
    if (!row) {
      if (opts.callbackId) {
        await tgAnswerCallbackQuery(opts.callbackId, "Образ ещё не открыт");
      }
      await sendLookHub(chatId, platformUserId);
      return true;
    }
    await sendLookConfirm(chatId, platformUserId, row);
    return true;
  }
  const ok = /^fv2:ph:ok:lk:(.+)$/.exec(data);
  if (!ok) return false;
  const lookId = ok[1]!;
  const session = await getTgSession(platformUserId);
  const pending = parsePending(session?.pendingJson || "{}");
  const photoUrl = (pending.funnelV2PhotoUrl || "").trim();
  if (!photoUrl) {
    if (opts.callbackId) {
      await tgAnswerCallbackQuery(opts.callbackId, "Сначала пришли фото");
    }
    await setTgSession(platformUserId, {
      chatState: "funnel_v2_awaiting_photo",
      pending: { funnelV2PendingLookId: lookId },
    });
    await funnelV2ReplaceUi(platformUserId, chatId, () =>
      tgSendMessage(
        chatId,
        "Сначала пришли фото одним сообщением, потом снова нажми Подтвердить.",
      ),
    );
    return true;
  }
  await runLookPack({
    chatId,
    userId: opts.userId,
    platformUserId,
    locale: opts.locale,
    lookId,
    photoUrl,
  });
  return true;
}

async function loadImageBytes(url: string): Promise<Buffer> {
  const { localBytesFromResultUrl } = await import("@/lib/peach-lab");
  if (url.startsWith("/api/media/") || url.startsWith("/")) {
    const buf = localBytesFromResultUrl(url);
    if (buf?.length) return buf;
  }
  const abs = url.startsWith("http") ? url : tgAbsoluteUrl(url);
  const res = await fetch(abs);
  if (!res.ok) throw new Error("Не удалось открыть картинку сцены");
  return Buffer.from(await res.arrayBuffer());
}

async function runDualFrame(opts: {
  person: Buffer;
  scene: Buffer;
  prompt: string;
  filenamePrefix: string;
}): Promise<Buffer> {
  const {
    comfyFreeMemory,
    comfyUploadImage,
    isRetryableComfyFlake,
    runComfyAndDownload,
    COMFY_PHOTO_TIMEOUT_MS,
  } = await import("@/lib/comfy-client");
  const { buildKreaDualRefEditGraph, KREA_UNDRESS_EXTRA_LORAS } = await import(
    "@/lib/krea-graphs"
  );
  const { undressImageSize, undressLatentSize } = await import(
    "@/lib/tg/undress-comfy"
  );

  const raw = undressImageSize(opts.person);
  const { width, height } = undressLatentSize(raw.width, raw.height);
  const sceneUp = await comfyUploadImage(
    `look_scene_${Date.now()}.png`,
    opts.scene,
  );
  const personUp = await comfyUploadImage(
    `look_person_${Date.now()}.jpg`,
    opts.person,
  );

  const graph = () => {
    const g = buildKreaDualRefEditGraph({
      sceneImageName: sceneUp,
      personImageName: personUp,
      editPrompt: opts.prompt,
      width,
      height,
      seed: Math.floor(Math.random() * 1e15),
      grounding: "scene_pose",
      refBoost: 5,
      refBoostA: 1.2,
      refBoostB: 1.45,
      useNsfwLora: true,
      extraLoras: KREA_UNDRESS_EXTRA_LORAS,
    }) as Record<string, { inputs?: { filename_prefix?: string } }>;
    if (g["15"]?.inputs) g["15"].inputs.filename_prefix = opts.filenamePrefix;
    return g;
  };

  await comfyFreeMemory();
  try {
    return await runComfyAndDownload(
      graph(),
      "peach-look-pack",
      COMFY_PHOTO_TIMEOUT_MS,
    );
  } catch (first) {
    if (!isRetryableComfyFlake(first)) throw first;
    await comfyFreeMemory();
    await new Promise((r) => setTimeout(r, 2500));
    await comfyFreeMemory();
    return await runComfyAndDownload(
      graph(),
      "peach-look-pack-retry",
      COMFY_PHOTO_TIMEOUT_MS,
    );
  }
}

function readPackMeta(raw: string): PackMeta | null {
  try {
    const v = JSON.parse(raw || "{}") as PackMeta;
    if (v.lookPack !== true || !Array.isArray(v.frameItemIds)) return null;
    return v;
  } catch {
    return null;
  }
}

async function deliverLookPack(parentId: string): Promise<void> {
  const parent = await prisma.galleryItem.findUnique({ where: { id: parentId } });
  if (!parent) return;
  const meta = readPackMeta(parent.metaJson);
  if (!meta || meta.lookSettled) return;
  const claimed = await prisma.galleryItem.updateMany({
    where: { id: parentId, metaJson: parent.metaJson },
    data: {
      metaJson: JSON.stringify({ ...meta, lookSettled: true, status: "ready" }),
    },
  });
  if (claimed.count !== 1) return;

  const frames = await prisma.galleryItem.findMany({
    where: { id: { in: meta.frameItemIds } },
  });
  const byId = new Map(frames.map((f) => [f.id, f]));
  const ready: Array<{ bytes: Buffer; index: number }> = [];
  let refund = 0;
  for (let i = 0; i < meta.frameItemIds.length; i++) {
    const item = byId.get(meta.frameItemIds[i]!);
    let status = "";
    try {
      status = String(
        (JSON.parse(item?.metaJson || "{}") as { status?: string }).status || "",
      );
    } catch {
      status = "";
    }
    const { localBytesFromResultUrl } = await import("@/lib/peach-lab");
    const bytes =
      status === "ready" && item?.resultUrl
        ? localBytesFromResultUrl(item.resultUrl)
        : null;
    if (bytes?.length && item) {
      ready.push({ bytes, index: i });
      let prev: Record<string, unknown> = {};
      try {
        prev = JSON.parse(item.metaJson || "{}") as Record<string, unknown>;
      } catch {
        prev = {};
      }
      await prisma.galleryItem.update({
        where: { id: item.id },
        data: {
          metaJson: JSON.stringify({ ...prev, hiddenFromTgGallery: false }),
        },
      });
    } else refund += meta.shares[i] || 0;
  }
  if (ready.length === 0) refund = meta.price;

  if (refund > 0) {
    await creditFunnelBalance(parent.userId, refund).catch((e) =>
      console.error("[look-pack] refund", e),
    );
  }

  const caption =
    ready.length === 0
      ? "Не получилось сделать образ. Деньги вернул на баланс."
      : ready.length === FRAME_COUNT
        ? `Готово. Образ «${meta.title}» — 5 фото.`
        : `Готово ${ready.length} из 5. За недостающие вернул ${refund}₽.`;

  try {
    if (ready.length >= 2) {
      await tgSendMediaGroupFiles(
        meta.chatId,
        ready.map((r) => ({ bytes: r.bytes, filename: `look-${r.index + 1}.jpg` })),
        caption,
      );
    } else if (ready.length === 1) {
      await tgSendPhotoFile(meta.chatId, ready[0]!.bytes, "look.jpg", caption);
    } else {
      await tgSendMessage(meta.chatId, caption);
    }
  } catch (e) {
    console.error("[look-pack] deliver", e);
    for (const frame of ready) {
      await tgSendPhotoFile(
        meta.chatId,
        frame.bytes,
        `look-${frame.index + 1}.jpg`,
      ).catch(() => undefined);
    }
    if (ready.length === 0) {
      await tgSendMessage(meta.chatId, caption).catch(() => undefined);
    }
  }
}

export async function settleAbandonedLookPack(parentId: string): Promise<void> {
  const parent = await prisma.galleryItem.findUnique({ where: { id: parentId } });
  if (!parent) return;
  const meta = readPackMeta(parent.metaJson);
  if (!meta || meta.lookSettled) return;
  for (const id of meta.frameItemIds) {
    const item = await prisma.galleryItem.findUnique({ where: { id } });
    if (!item) continue;
    let status = "";
    try {
      status = String(
        (JSON.parse(item.metaJson || "{}") as { status?: string }).status || "",
      );
    } catch {
      status = "";
    }
    if (status === "ready" || status === "error") continue;
    await prisma.galleryItem.update({
      where: { id },
      data: {
        metaJson: JSON.stringify({
          status: "error",
          lookPack: true,
          error: "pack interrupted",
        }),
      },
    });
  }
  await deliverLookPack(parentId);
}

export async function runLookPack(opts: {
  chatId: number;
  userId: string;
  platformUserId: string;
  locale: TgLocale;
  lookId: string;
  photoUrl: string;
}): Promise<void> {
  await setTgSession(opts.platformUserId, {
    pending: { funnelV2PendingLookId: "" },
  });

  const pack = await prisma.funnelLookPack.findFirst({
    where: { id: opts.lookId, funnelV2Published: true },
  });
  if (!pack || !lookScenesReady(parseLookScenes(pack.scenesJson))) {
    await tgSendMessage(opts.chatId, "Этот образ ещё не открыт.");
    return;
  }
  const scenes = parseLookScenes(pack.scenesJson);
  const price = pack.pricePeaches;
  const user = await prisma.user.findUnique({ where: { id: opts.userId } });
  if (!user) return;
  const bal = await getFunnelBalance(user);
  if (bal < price) {
    const { sendCoverPhoto } = await import("@/lib/tg/funnel-v2/media");
    await funnelV2ReplaceUi(opts.platformUserId, opts.chatId, () =>
      sendCoverPhoto(
        opts.chatId,
        "needTopup",
        "Сейчас я не могу сделать этот образ, пока ты не пополнишь баланс.",
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

  let person: Buffer;
  try {
    person = await loadImageBytes(opts.photoUrl);
    const { assertImageAllowedForGeneration } = await import("@/lib/age-gate");
    await assertImageAllowedForGeneration(person, opts.locale, {
      userId: opts.userId,
    });
  } catch (e) {
    const { AgeGateBlockedError, AgeGateUncertainError } = await import(
      "@/lib/age-gate"
    );
    if (e instanceof AgeGateUncertainError || e instanceof AgeGateBlockedError) {
      await tgSendMessage(opts.chatId, e.message);
      return;
    }
    await tgSendMessage(opts.chatId, "Не удалось прочитать фото. Пришли его ещё раз.");
    return;
  }

  const { decideUserPhoto, waitForUserGpuJob, withUserGenLock } = await import(
    "@/lib/gpu/user-gen-limit"
  );
  let blocked = "";
  let parentId = "";
  await withUserGenLock(opts.userId, async () => {
    const gate = await decideUserPhoto(opts.userId);
    if (gate.action === "reject") {
      blocked = gate.message;
      return;
    }
    const deb = await debitFunnelBalance(opts.userId, price);
    if (!deb.ok) {
      blocked = "Недостаточно средств на балансе.";
      return;
    }
    const shares = lookFrameShares(price);
    const title = buttonTitle(pack);
    const frames = [];
    for (let i = 0; i < FRAME_COUNT; i++) {
      frames.push(
        await prisma.galleryItem.create({
          data: {
            userId: opts.userId,
            kind: "photo",
            title: `${title} ${i + 1}/5`,
            prompt: scenes[i]!.editPrompt.slice(0, 500),
            editPrompt: scenes[i]!.editPrompt.slice(0, 2000),
            resultUrl: GALLERY_PLACEHOLDER_URL,
            metaJson: JSON.stringify({
              status: "pending",
              lookPack: true,
              lookPackId: pack.id,
              frameIndex: i,
              hiddenFromTgGallery: true,
              engine: "funnel_v2_look_pack",
              source: "funnel_v2",
              funnelV2: true,
            }),
          },
        }),
      );
    }
    const meta: PackMeta = {
      lookPack: true,
      lookSettled: false,
      lookPackId: pack.id,
      title,
      price,
      shares,
      frameItemIds: frames.map((f) => f.id),
      platformUserId: opts.platformUserId,
      chatId: opts.chatId,
      locale: opts.locale,
    };
    const parent = await prisma.galleryItem.create({
      data: {
        userId: opts.userId,
        kind: "photo",
        title: `${title} · пак`,
        prompt: "look pack",
        resultUrl: GALLERY_PLACEHOLDER_URL,
        metaJson: JSON.stringify({ ...meta, status: "pending", hiddenFromTgGallery: true }),
      },
    });
    parentId = parent.id;
    const { enqueueGpuJob } = await import("@/lib/gallery-jobs");
    void enqueueGpuJob(
      () => executeLookPackJob({ parentId: parent.id, person, scenes }),
      {
        userId: opts.userId,
        kind: "look_pack",
        pool: "photo",
        title: title,
        refType: "lookPack",
        refId: parent.id,
        meta: { lookPackId: pack.id },
      },
    );
    await waitForUserGpuJob("lookPack", parent.id);
  });

  if (blocked) {
    await tgSendMessage(opts.chatId, blocked);
    return;
  }
  if (!parentId) {
    await tgSendMessage(opts.chatId, "Не удалось поставить образ в очередь.");
    return;
  }
  await funnelV2ReplaceUi(opts.platformUserId, opts.chatId, () =>
    tgSendMessage(
      opts.chatId,
      "⏳ <b>Делаю образ из 5 фото.</b>\n\nОни пойдут одним альбомом, когда весь набор будет готов.",
    ),
  );
}

async function executeLookPackJob(opts: {
  parentId: string;
  person: Buffer;
  scenes: LookScene[];
}) {
  const { noteGpuJobStage } = await import("@/lib/gpu/orchestrator");
  const parent = await prisma.galleryItem.findUnique({
    where: { id: opts.parentId },
  });
  const meta = parent ? readPackMeta(parent.metaJson) : null;
  if (!parent || !meta) return;

  for (let i = 0; i < meta.frameItemIds.length; i++) {
    const itemId = meta.frameItemIds[i]!;
    const scene = opts.scenes[i];
    await noteGpuJobStage("look_frame", `${i + 1}/5`);
    try {
      if (!scene) throw new Error("нет сцены");
      const sceneBytes = await loadImageBytes(scene.sceneImageUrl);
      const out = await runDualFrame({
        person: opts.person,
        scene: sceneBytes,
        prompt: scene.editPrompt,
        filenamePrefix: `peach/look_${itemId}`,
      });
      const saved = saveGalleryBinary(parent.userId, "png", out, `look_${itemId}`);
      await prisma.galleryItem.update({
        where: { id: itemId },
        data: {
          resultUrl: saved.publicUrl,
          metaJson: JSON.stringify({
            status: "ready",
            lookPack: true,
            lookPackId: meta.lookPackId,
            frameIndex: i,
            hiddenFromTgGallery: true,
            localKey: saved.relKey,
            engine: "funnel_v2_look_pack",
            source: "funnel_v2",
            funnelV2: true,
          }),
        },
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[look-pack] frame", i + 1, msg.slice(0, 200));
      await prisma.galleryItem.update({
        where: { id: itemId },
        data: {
          metaJson: JSON.stringify({
            status: "error",
            lookPack: true,
            lookPackId: meta.lookPackId,
            frameIndex: i,
            error: msg.slice(0, 300),
          }),
        },
      });
    }
  }
  await deliverLookPack(opts.parentId);
}
