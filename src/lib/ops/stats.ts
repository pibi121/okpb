import { prisma } from "@/lib/db";
import { gpuRuntimeSnapshot } from "@/lib/ops/queue";
import { getOpsSettings } from "@/lib/ops/settings";
import { galleryStatus, parseGalleryMeta } from "@/lib/gallery-meta";

function startOfDay(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function avgMs(items: { createdAt: Date; updatedAt: Date }[]) {
  if (!items.length) return 0;
  const sum = items.reduce(
    (a, i) => a + Math.max(0, i.updatedAt.getTime() - i.createdAt.getTime()),
    0,
  );
  return Math.round(sum / items.length);
}

export async function collectOpsStats() {
  const today = startOfDay();
  const dayAgo = new Date(Date.now() - 24 * 3600 * 1000);
  const stuckAfter = new Date(Date.now() - 15 * 60 * 1000);

  const [
    usersTotal,
    usersToday,
    confirmed,
    withCharacter,
    withJob,
    paidUsers,
    peachesInToday,
    galleryToday,
    videoToday,
    errorsOpen,
    errorsToday,
    pendingGallery,
    busyVideo,
    stuckGallery,
    stuckVideo,
    settings,
    trainReadyToday,
    trainBusy,
  ] = await Promise.all([
    prisma.user.count({ where: { source: "telegram" } }),
    prisma.user.count({ where: { source: "telegram", createdAt: { gte: today } } }),
    prisma.user.count({ where: { source: "telegram", ageConfirmed: true } }),
    prisma.user.count({
      where: { source: "telegram", characters: { some: {} } },
    }),
    prisma.user.count({
      where: { source: "telegram", galleryItems: { some: {} } },
    }),
    prisma.user.count({
      where: {
        source: "telegram",
        ledger: { some: { amount: { gt: 0 }, reason: { contains: "topup" } } },
      },
    }),
    prisma.ledgerEntry.aggregate({
      where: {
        amount: { gt: 0 },
        createdAt: { gte: today },
        reason: { contains: "topup" },
      },
      _sum: { amount: true },
    }),
    prisma.galleryItem.count({
      where: { createdAt: { gte: today }, kind: "photo" },
    }),
    prisma.galleryItem.count({
      where: { createdAt: { gte: today }, kind: { in: ["video", "clip"] } },
    }),
    prisma.opsError.count({ where: { status: "open" } }),
    prisma.opsError.count({ where: { lastAt: { gte: today } } }),
    prisma.galleryItem.count({
      where: { metaJson: { contains: "\"status\":\"pending\"" } },
    }),
    prisma.quickVideoRun.count({ where: { status: "busy" } }),
    prisma.galleryItem.count({
      where: {
        metaJson: { contains: "\"status\":\"pending\"" },
        createdAt: { lt: stuckAfter },
      },
    }),
    prisma.quickVideoRun.count({
      where: { status: "busy", updatedAt: { lt: stuckAfter } },
    }),
    getOpsSettings(),
    prisma.character.count({
      where: { loraStatus: "lora_ready", updatedAt: { gte: today } },
    }),
    prisma.character.count({ where: { loraStatus: "lora_training" } }),
  ]);

  const [photoDone, videoDone, loraDone] = await Promise.all([
    prisma.galleryItem.findMany({
      where: {
        kind: "photo",
        createdAt: { gte: dayAgo },
        metaJson: { contains: "\"status\":\"ready\"" },
      },
      select: { createdAt: true, updatedAt: true },
      take: 200,
    }),
    prisma.quickVideoRun.findMany({
      where: { status: "ready", createdAt: { gte: dayAgo } },
      select: { createdAt: true, updatedAt: true },
      take: 200,
    }),
    prisma.character.findMany({
      where: { loraStatus: "lora_ready", updatedAt: { gte: dayAgo } },
      select: { createdAt: true, updatedAt: true },
      take: 50,
    }),
  ]);

  const gpu = gpuRuntimeSnapshot();

  return {
    today: {
      users: usersToday,
      peachesIn: peachesInToday._sum.amount || 0,
      photos: galleryToday,
      videos: videoToday,
      trains: trainReadyToday,
      errors: errorsToday,
    },
    funnel: {
      users: usersTotal,
      confirmed,
      withCharacter,
      withJob,
      paid: paidUsers,
    },
    queue: {
      pendingGallery,
      busyVideo,
      stuckGallery,
      stuckVideo,
      training: trainBusy,
      gpu,
    },
    avgMs: {
      photo: avgMs(photoDone),
      video: avgMs(videoDone),
      lora: avgMs(loraDone),
    },
    errorsOpen,
    maintenance: settings.maintenance,
    loadMode: settings.loadMode,
  };
}

export async function collectQueueDetails() {
  const stuckAfter = new Date(Date.now() - 15 * 60 * 1000);
  const [pending, busy, gpu, settings] = await Promise.all([
    prisma.galleryItem.findMany({
      where: { metaJson: { contains: "\"status\":\"pending\"" } },
      orderBy: { createdAt: "asc" },
      take: 40,
      select: {
        id: true,
        userId: true,
        kind: true,
        title: true,
        createdAt: true,
        metaJson: true,
        user: { select: { name: true, email: true } },
      },
    }),
    prisma.quickVideoRun.findMany({
      where: { status: { in: ["busy", "error"] } },
      orderBy: { updatedAt: "desc" },
      take: 40,
      select: {
        id: true,
        userId: true,
        title: true,
        status: true,
        error: true,
        createdAt: true,
        updatedAt: true,
        galleryItemId: true,
        user: { select: { name: true, email: true } },
      },
    }),
    Promise.resolve(gpuRuntimeSnapshot()),
    getOpsSettings(),
  ]);

  return {
    gpu,
    maintenance: settings.maintenance,
    loadMode: settings.loadMode,
    pending: pending.map((p) => ({
      ...p,
      status: galleryStatus(p.metaJson),
      error: parseGalleryMeta(p.metaJson).error || null,
      stuck: p.createdAt < stuckAfter,
      createdAt: p.createdAt.toISOString(),
    })),
    videos: busy.map((v) => ({
      ...v,
      stuck: v.status === "busy" && v.updatedAt < stuckAfter,
      createdAt: v.createdAt.toISOString(),
      updatedAt: v.updatedAt.toISOString(),
    })),
  };
}

export async function probeBotHealth() {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) {
    return { ok: false, username: null, detail: "Токен бота не задан в env" };
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getMe`, {
      cache: "no-store",
      signal: AbortSignal.timeout(4000),
    });
    const json = (await res.json()) as {
      ok?: boolean;
      result?: { username?: string };
      description?: string;
    };
    if (!json.ok) {
      return { ok: false, username: null, detail: json.description || "Telegram отказал" };
    }
    return { ok: true, username: json.result?.username || null, detail: "Primary (env) отвечает" };
  } catch {
    return { ok: false, username: null, detail: "Telegram не ответил" };
  }
}

export async function probeAllBotsHealth() {
  try {
    const { listLiveBots } = await import("@/lib/tg/bot-registry");
    const bots = await listLiveBots();
    const out: Array<{
      id: string;
      username: string;
      isPrimary: boolean;
      ok: boolean;
      detail: string;
    }> = [];
    for (const b of bots) {
      try {
        const res = await fetch(`https://api.telegram.org/bot${b.token}/getMe`, {
          cache: "no-store",
          signal: AbortSignal.timeout(4000),
        });
        const json = (await res.json()) as {
          ok?: boolean;
          description?: string;
          result?: { username?: string };
        };
        out.push({
          id: b.id,
          username: b.username,
          isPrimary: b.isPrimary,
          ok: Boolean(json.ok),
          detail: json.ok
            ? `@${json.result?.username || b.username} OK`
            : json.description || "отказ",
        });
      } catch {
        out.push({
          id: b.id,
          username: b.username,
          isPrimary: b.isPrimary,
          ok: false,
          detail: "нет ответа",
        });
      }
    }
    return out;
  } catch {
    return [];
  }
}

export async function probeGpuHealth() {
  const url = (process.env.COMFY_URL || "").replace(/\/$/, "");
  if (!url) return { ok: false, detail: "Адрес видеокарты не задан" };
  try {
    const res = await fetch(`${url}/queue`, {
      cache: "no-store",
      signal: AbortSignal.timeout(2500),
    });
    if (!res.ok) return { ok: false, detail: "Видеокарта не ответила" };
    const q = (await res.json()) as {
      queue_running?: unknown[];
      queue_pending?: unknown[];
    };
    return {
      ok: true,
      detail: "Видеокарта отвечает",
      running: q.queue_running?.length || 0,
      pending: q.queue_pending?.length || 0,
    };
  } catch {
    return { ok: false, detail: "Видеокарта не отвечает" };
  }
}
