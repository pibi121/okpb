/**
 * Pause user video generation. Photos stay available.
 * Turning it on refunds in-progress user videos and tells everyone.
 */
import { prisma } from "@/lib/db";
import { getOpsSettings, saveOpsSettings } from "@/lib/ops/settings";
import { creditPeaches } from "@/lib/tg/wallet";

export const VIDEO_FREEZE_BROADCAST = `Уважаемые пользователи!

Сейчас мы испытываем высокую нагрузку на генераторе видео. Вся команда работает над тем, чтобы восстановить работу и вы могли дальше наслаждаться сервисом.

Как только этот раздел будет доступен (в ближайшие часы), вам придет уведомление, а также всем, кто столкнулся с проблемами 🎁 будет начислен бонусный баланс за неудобства.

Приносим свои извинения за временные неудобства 🙏`;

export const VIDEO_FREEZE_BACK_BROADCAST = `Видео снова доступно.

Можно пользоваться разделом как раньше. Спасибо, что подождали.`;

const ACTIVE = ["pending", "busy", "queued", "running"];

function parseMeta(raw: string | null | undefined): Record<string, unknown> {
  try {
    return JSON.parse(raw || "{}") as Record<string, unknown>;
  } catch {
    return {};
  }
}

export async function isVideoFrozen(): Promise<boolean> {
  const s = await getOpsSettings();
  return s.videoFrozen;
}

export async function assertVideoGenerationOpen(userId?: string): Promise<void> {
  if (!(await isVideoFrozen())) return;
  if (userId) await noteVideoFreezeAttempt(userId);
  throw new Error(VIDEO_FREEZE_BROADCAST);
}

/** Remember a user who tried to start video while it is frozen. */
export async function noteVideoFreezeAttempt(userId: string): Promise<void> {
  if (!userId) return;
  await addAudience([userId]);
}

async function closeGpuJobs(refType: string, refId: string) {
  const jobs = await prisma.gpuJob.findMany({
    where: {
      refType,
      refId,
      status: { in: ["queued", "assigned", "running"] },
    },
    select: { id: true, workerId: true, status: true },
  });
  if (!jobs.length) return;
  await prisma.gpuJob.updateMany({
    where: { id: { in: jobs.map((j) => j.id) } },
    data: {
      status: "error",
      stage: "error",
      error: "video frozen",
      finishedAt: new Date(),
    },
  });
  // A running render still occupies the card. Leave that worker busy
  // until the waiter exits. Only free cards that had not started yet.
  const idleJobs = jobs.filter((j) => j.status !== "running");
  const workerIds = idleJobs
    .map((j) => j.workerId)
    .filter((id): id is string => Boolean(id));
  if (workerIds.length) {
    await prisma.gpuWorker.updateMany({
      where: {
        id: { in: workerIds },
        currentJobId: { in: idleJobs.map((j) => j.id) },
      },
      data: { currentJobId: null, status: "online" },
    });
  }
}

async function refundGalleryVideo(itemId: string, userId: string): Promise<boolean> {
  const item = await prisma.galleryItem.findUnique({ where: { id: itemId } });
  if (!item || item.userId !== userId) return false;
  const meta = parseMeta(item.metaJson);
  if (meta.ownerLab === true) return false;
  if (meta.videoFrozenRefund === true) return false;
  const status = String(meta.status || "");
  if (status !== "pending" && status !== "busy") return false;

  const charged = Number(meta.chargedPeaches || 0) || 0;
  const already = Number(meta.refundedPeaches || 0) || 0;
  let refunded = already;
  if (charged > 0 && already <= 0) {
    await creditPeaches(userId, charged, "tg_video_refund", {
      galleryItemId: itemId,
      reason: "video_frozen",
    });
    refunded = charged;
  }

  await prisma.galleryItem.update({
    where: { id: itemId },
    data: {
      metaJson: JSON.stringify({
        ...meta,
        status: "error",
        error: "Генерация видео временно остановлена, оплата возвращена.",
        videoFrozenRefund: true,
        refundedPeaches: refunded || undefined,
      }),
    },
  });
  await closeGpuJobs("galleryItem", itemId);
  return true;
}

/** Refund and close user videos that are still in progress. Photos are not touched. */
export async function refundInProgressUserVideos(): Promise<{
  refunded: number;
  userIds: string[];
}> {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  let n = 0;
  const userIds = new Set<string>();
  const { failQuickVideoRun } = await import("@/lib/quick-video");
  const skipRunIds: string[] = [];

  for (let page = 0; page < 25; page++) {
    const runs = await prisma.quickVideoRun.findMany({
      where: {
        status: { in: ACTIVE },
        createdAt: { gte: since },
        ...(skipRunIds.length ? { id: { notIn: skipRunIds } } : {}),
      },
      select: { id: true, userId: true, galleryItemId: true },
      take: 200,
    });
    if (!runs.length) break;
    for (const run of runs) {
      try {
        if (run.galleryItemId) {
          const item = await prisma.galleryItem.findUnique({
            where: { id: run.galleryItemId },
            select: { metaJson: true },
          });
          if (parseMeta(item?.metaJson).ownerLab === true) {
            skipRunIds.push(run.id);
            continue;
          }
        }
        await failQuickVideoRun(
          run.id,
          run.userId,
          "Генерация видео временно остановлена, оплата возвращена.",
          { notify: false },
        );
        if (run.galleryItemId) {
          const item = await prisma.galleryItem.findUnique({
            where: { id: run.galleryItemId },
            select: { metaJson: true },
          });
          const meta = parseMeta(item?.metaJson);
          if (meta.videoFrozenRefund !== true) {
            await prisma.galleryItem.update({
              where: { id: run.galleryItemId },
              data: {
                metaJson: JSON.stringify({ ...meta, videoFrozenRefund: true }),
              },
            });
          }
        }
        await closeGpuJobs("quickVideoRun", run.id);
        n += 1;
        userIds.add(run.userId);
      } catch (e) {
        skipRunIds.push(run.id);
        console.error("[peach] video freeze refund run:", run.id, e);
      }
    }
  }

  const skipItemIds: string[] = [];
  for (let page = 0; page < 25; page++) {
    const items = await prisma.galleryItem.findMany({
      where: {
        kind: { in: ["video", "film"] },
        createdAt: { gte: since },
        ...(skipItemIds.length ? { id: { notIn: skipItemIds } } : {}),
      },
      select: { id: true, userId: true, metaJson: true },
      take: 300,
    });
    if (!items.length) break;
    let progressed = false;
    for (const item of items) {
      const meta = parseMeta(item.metaJson);
      if (meta.ownerLab === true || meta.videoFrozenRefund === true) {
        skipItemIds.push(item.id);
        continue;
      }
      const status = String(meta.status || "");
      if (status !== "pending" && status !== "busy") {
        skipItemIds.push(item.id);
        continue;
      }
      try {
        if (await refundGalleryVideo(item.id, item.userId)) {
          n += 1;
          userIds.add(item.userId);
          progressed = true;
        } else {
          skipItemIds.push(item.id);
        }
      } catch (e) {
        skipItemIds.push(item.id);
        console.error("[peach] video freeze refund item:", item.id, e);
      }
    }
    if (!progressed && items.every((item) => skipItemIds.includes(item.id))) break;
  }

  return { refunded: n, userIds: [...userIds] };
}

async function readAudience(): Promise<string[]> {
  const row = await prisma.opsSetting.findUnique({
    where: { id: "main" },
    select: { videoFreezeAudienceJson: true },
  });
  try {
    const parsed = JSON.parse(row?.videoFreezeAudienceJson || "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === "string" && id.length > 0);
  } catch {
    return [];
  }
}

async function addAudience(userIds: string[]) {
  const next = [...new Set([...(await readAudience()), ...userIds.filter(Boolean)])];
  await prisma.opsSetting.update({
    where: { id: "main" },
    data: { videoFreezeAudienceJson: JSON.stringify(next) },
  });
}

async function notifyUsers(userIds: string[], text: string): Promise<number> {
  const { tgNotifyUser } = await import("@/lib/tg/notify-user");
  let sent = 0;
  for (const userId of [...new Set(userIds)]) {
    try {
      if (await tgNotifyUser({ userId, text })) sent += 1;
    } catch (e) {
      console.error("[peach] video freeze notify:", userId, e);
    }
    await new Promise((r) => setTimeout(r, 40));
  }
  return sent;
}

export async function enableVideoFreeze(_actorId: string) {
  await saveOpsSettings({ videoFrozen: true });
  const { refunded, userIds } = await refundInProgressUserVideos();
  await addAudience(userIds);
  const notified = await notifyUsers(userIds, VIDEO_FREEZE_BROADCAST);
  return { refunded, notified };
}

export async function disableVideoFreeze(_actorId: string) {
  const userIds = await readAudience();
  await saveOpsSettings({ videoFrozen: false });
  const notified = await notifyUsers(userIds, VIDEO_FREEZE_BACK_BROADCAST);
  await prisma.opsSetting.update({
    where: { id: "main" },
    data: { videoFreezeAudienceJson: "[]" },
  });
  return { notified };
}
