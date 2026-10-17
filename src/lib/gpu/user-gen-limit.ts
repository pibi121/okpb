/**
 * Per-user in-flight caps. No schema change:
 * photos/videos on a GPU are GpuJob rows; a video waiting for the user's
 * photos is a gallery item with meta.gpuDeferred (and quickVideoRun status
 * "deferred" when that pipeline is used).
 *
 * Rules:
 * - 1 video in flight (on GPU or deferred)
 * - 2 photos, and only when that user has no video in flight
 * - a new video while photos are still running is accepted and deferred
 * Lab pool jobs are not counted.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { prisma } from "@/lib/db";

export const USER_GEN_TEXT = {
  videoBusy:
    "Эх, у меня пока не хватает рук, чтобы сделать для тебя ещё одно видео 🥺 Пожалуйста, дождись выполнения той генерации, которую ты уже заказал, и повтори свой запрос — я всё обязательно сделаю.",
  photoWhileVideo:
    "Я не смогу одновременно сделать фотографии, пока идёт генерация твоего видео 🥺 Пожалуйста, дождись генерации видео и повтори свой запрос — я всё обязательно сделаю для тебя фотографии.",
  photosFull:
    "Подожди чуть-чуть 🥺 Я уже заканчиваю делать для тебя фотографии, которые ты заказал, и после этого ты сможешь сгенерировать новые фотки.",
  generic:
    "Сейчас нельзя сделать ещё одну генерацию, пока у тебя идут другие 🥺 Дождись — совсем скоро я отправлю тебе материал, и можно будет продолжить генерировать новые фото и видео.",
  videoAfterPhotos: "Сейчас доделаю фото и приступлю к видео.",
  videoStarting: "Приступаю к видео.",
} as const;

export type UserGenLimitCode =
  | "video_busy"
  | "photo_while_video"
  | "photos_full"
  | "generic";

export class UserGenLimitError extends Error {
  readonly code: UserGenLimitCode;
  constructor(code: UserGenLimitCode, message: string) {
    super(message);
    this.name = "UserGenLimitError";
    this.code = code;
  }
}

export function isUserGenLimitError(e: unknown): e is UserGenLimitError {
  return e instanceof UserGenLimitError || (e instanceof Error && e.name === "UserGenLimitError");
}

export type PhotoDecision =
  | { action: "allow" }
  | { action: "reject"; code: UserGenLimitCode; message: string };

export type VideoDecision =
  | { action: "allow" }
  | { action: "defer" }
  | { action: "reject"; code: UserGenLimitCode; message: string };

const lockStore = new AsyncLocalStorage<string>();
const lockTail = new Map<string, Promise<void>>();

/** Serializes one user's accept/reject so two clicks cannot both pass. Re-entrant for the same user. */
export function withUserGenLock<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  if (lockStore.getStore() === userId) return fn();
  const prev = lockTail.get(userId) ?? Promise.resolve();
  const run = prev.catch(() => undefined).then(() => lockStore.run(userId, fn));
  lockTail.set(
    userId,
    run.then(
      () => undefined,
      () => undefined,
    ),
  );
  return run;
}

function parseMeta(raw: string | null | undefined): Record<string, unknown> {
  try {
    return JSON.parse(raw || "{}") as Record<string, unknown>;
  } catch {
    return {};
  }
}

function mediaOf(pool: string, kind: string): "photo" | "video" | null {
  if (pool === "lab" || pool === "lora") return null;
  if (pool === "photo") return "photo";
  if (pool === "video") return "video";
  const k = kind.toLowerCase();
  if (k.includes("photo") || k.includes("undress") || k.includes("still")) return "photo";
  if (
    k.includes("video") ||
    k.includes("i2v") ||
    k.includes("clip") ||
    k.includes("film") ||
    k.includes("animate")
  ) {
    return "video";
  }
  return null;
}

async function inflight(userId: string): Promise<{ photos: number; videos: number }> {
  const [jobs, deferredRows] = await Promise.all([
    prisma.gpuJob.findMany({
      where: {
        userId,
        status: { in: ["queued", "assigned", "running"] },
        pool: { not: "lab" },
      },
      select: { pool: true, kind: true },
    }),
    prisma.galleryItem.findMany({
      where: {
        userId,
        kind: "video",
        metaJson: { contains: '"gpuDeferred":true' },
      },
      select: { metaJson: true },
      take: 20,
    }),
  ]);
  let photos = 0;
  let videos = 0;
  for (const job of jobs) {
    const media = mediaOf(job.pool, job.kind);
    if (media === "photo") photos += 1;
    else if (media === "video") videos += 1;
  }
  for (const row of deferredRows) {
    const meta = parseMeta(row.metaJson);
    if (meta.gpuDeferred !== true) continue;
    if (meta.status === "ready" || meta.status === "error") continue;
    videos += 1;
  }
  return { photos, videos };
}

function reject(code: UserGenLimitCode, message: string): PhotoDecision & { action: "reject" } {
  return { action: "reject", code, message };
}

export async function decideUserPhoto(userId: string): Promise<PhotoDecision> {
  try {
    const { photos, videos } = await inflight(userId);
    if (videos > 0) return reject("photo_while_video", USER_GEN_TEXT.photoWhileVideo);
    if (photos >= 2) return reject("photos_full", USER_GEN_TEXT.photosFull);
    return { action: "allow" };
  } catch (e) {
    console.error("[user-gen-limit] photo decide:", e);
    return reject("generic", USER_GEN_TEXT.generic);
  }
}

export async function decideUserVideo(userId: string): Promise<VideoDecision> {
  try {
    const { photos, videos } = await inflight(userId);
    if (videos > 0) return reject("video_busy", USER_GEN_TEXT.videoBusy);
    if (photos > 0) return { action: "defer" };
    return { action: "allow" };
  } catch (e) {
    console.error("[user-gen-limit] video decide:", e);
    return reject("generic", USER_GEN_TEXT.generic);
  }
}

export function throwIfRejected(
  decision: PhotoDecision | VideoDecision,
): void {
  if (decision.action === "reject") {
    throw new UserGenLimitError(decision.code, decision.message);
  }
}

/** Hold the accept-lock until the GpuJob row exists, so a second click cannot pass the count. */
export async function waitForUserGpuJob(
  refType: string,
  refId: string,
  ms = 2500,
): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const row = await prisma.gpuJob.findFirst({
      where: {
        refType,
        refId,
        status: { in: ["queued", "assigned", "running"] },
      },
      select: { id: true },
    });
    if (row) return;
    await new Promise((r) => setTimeout(r, 40));
  }
}

export async function tellUserGenText(userId: string, text: string): Promise<void> {
  const acc = await prisma.platformAccount.findFirst({
    where: { userId, platform: "telegram" },
    select: { platformUserId: true },
  });
  if (!acc?.platformUserId) return;
  const { tgSendMessage } = await import("@/lib/tg/telegram-api");
  await tgSendMessage(acc.platformUserId, text).catch(() => undefined);
}

async function liveGpuJob(itemId: string, quickVideoRunId: string | null) {
  return prisma.gpuJob.findFirst({
    where: {
      status: { in: ["queued", "assigned", "running"] },
      OR: [
        { refType: "galleryItem", refId: itemId },
        ...(quickVideoRunId
          ? [{ refType: "quickVideoRun" as const, refId: quickVideoRunId }]
          : []),
      ],
    },
    select: { id: true },
  });
}

async function patchMeta(
  itemId: string,
  prevRaw: string,
  next: Record<string, unknown>,
): Promise<boolean> {
  const updated = await prisma.galleryItem.updateMany({
    where: { id: itemId, metaJson: prevRaw },
    data: { metaJson: JSON.stringify(next) },
  });
  return updated.count === 1;
}

/** Move deferred videos onto the GPU once that user has no photos left. */
export async function promoteDeferredUserVideos(): Promise<void> {
  const { maintenanceStubText } = await import("@/lib/ops/maintenance-stub");
  if (await maintenanceStubText()) return;
  const items = await prisma.galleryItem.findMany({
    where: {
      kind: "video",
      metaJson: { contains: '"gpuDeferred":true' },
    },
    orderBy: { createdAt: "asc" },
    take: 30,
    select: { id: true, userId: true, metaJson: true, prompt: true, title: true, characterId: true },
  });

  for (const item of items) {
    const meta = parseMeta(item.metaJson);
    if (meta.gpuDeferred !== true) continue;
    if (meta.status === "ready" || meta.status === "error") continue;
    const qvId = typeof meta.quickVideoRunId === "string" ? meta.quickVideoRunId : null;
    try {
      const job = await liveGpuJob(item.id, qvId);
      if (job) {
        if (!meta.gpuDeferNotified) {
          await tellUserGenText(item.userId, USER_GEN_TEXT.videoStarting);
        }
        await patchMeta(item.id, item.metaJson, {
          ...meta,
          gpuDeferred: false,
          gpuDeferNotified: true,
        });
        continue;
      }

      const { photos } = await inflight(item.userId);
      if (photos > 0) continue;
      if (meta.gpuEnqueueStarted === true) {
        await kickDeferred(item, meta);
        continue;
      }

      const claimed = await patchMeta(item.id, item.metaJson, {
        ...meta,
        gpuEnqueueStarted: true,
        gpuDeferNotified: true,
      });
      if (!claimed) continue;
      await tellUserGenText(item.userId, USER_GEN_TEXT.videoStarting);
      await kickDeferred(item, { ...meta, gpuEnqueueStarted: true });
    } catch (e) {
      console.error(
        "[user-gen-limit] promote",
        item.id,
        e instanceof Error ? e.message : e,
      );
    }
  }
}

async function kickDeferred(
  item: {
    id: string;
    userId: string;
    prompt: string | null;
    title: string | null;
    characterId: string | null;
  },
  meta: Record<string, unknown>,
) {
  const qvId = typeof meta.quickVideoRunId === "string" ? meta.quickVideoRunId : "";
  if (qvId) {
    await prisma.quickVideoRun.updateMany({
      where: { id: qvId, status: "deferred" },
      data: { status: "busy" },
    });
    const { enqueueQuickVideoJob } = await import("@/lib/quick-video");
    enqueueQuickVideoJob(qvId, item.userId, { useOwnerLab: false });
    return;
  }
  if (meta.jobAction === "lora_i2v") {
    const { startDeferredLoraItem } = await import("@/lib/tg/generation-service");
    await startDeferredLoraItem(item.id);
    return;
  }
  if (meta.jobAction === "clip") {
    const { kickDeferredClipJob } = await import("@/lib/gallery-jobs");
    kickDeferredClipJob(item.id, item.userId, meta);
  }
}
