/**
 * A pose batch lives in one process. After a restart the finished clips are
 * already on disk, and the clip still on the GPU is pulled from Comfy history.
 * Then the remaining poses run, and the film is stitched and sent.
 */
import fs from "node:fs";
import { prisma } from "@/lib/db";
import {
  comfyDownloadImage,
  comfyUploadImage,
  comfyWaitHistory,
  runComfyJob,
} from "@/lib/comfy-client";
import { withGpuJobContext } from "@/lib/gpu/orchestrator";
import { resolveGalleryFile } from "@/lib/local-store";
import { poseById, posePriceRub, POSE_DEFAULT_MAN } from "@/lib/pose-constructor/catalog";
import { buildPoseClipGraph } from "@/lib/pose-constructor/graph";
import { deliverPoseFilm, mergePoseItemMeta } from "@/lib/pose-constructor/run";

const STALE_MS = 2 * 60 * 1000;
const LOCK_MS = 3 * 60 * 1000;

function parseMeta(raw: string | null | undefined): Record<string, unknown> {
  try {
    return JSON.parse(raw || "{}") as Record<string, unknown>;
  } catch {
    return {};
  }
}

function clipsOf(meta: Record<string, unknown>) {
  const raw = meta.poseClips;
  if (!Array.isArray(raw)) return [] as { poseId: string; fileKey: string; title: string }[];
  return raw.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const r = row as { poseId?: unknown; fileKey?: unknown; title?: unknown };
    if (typeof r.poseId !== "string" || typeof r.fileKey !== "string") return [];
    return [
      {
        poseId: r.poseId,
        fileKey: r.fileKey,
        title: typeof r.title === "string" ? r.title : r.poseId,
      },
    ];
  });
}

async function beat(jobId: string) {
  const job = await prisma.gpuJob.findUnique({
    where: { id: jobId },
    select: { metaJson: true, status: true },
  });
  if (!job || job.status !== "running") return false;
  const meta = parseMeta(job.metaJson);
  meta.lastBeatAt = new Date().toISOString();
  meta.poseLockUntil = new Date(Date.now() + LOCK_MS).toISOString();
  await prisma.gpuJob.update({
    where: { id: jobId },
    data: { metaJson: JSON.stringify(meta) },
  });
  return true;
}

async function continuePoseJob(job: {
  id: string;
  refId: string;
  metaJson: string;
  worker: { comfyUrl: string } | null;
}) {
  const item = await prisma.galleryItem.findUnique({
    where: { id: job.refId },
    select: { id: true, userId: true, metaJson: true },
  });
  if (!item) return;
  const meta = parseMeta(item.metaJson);
  const poseIds = Array.isArray(meta.poseIds)
    ? meta.poseIds.filter((id): id is string => typeof id === "string")
    : [];
  const chatId = Number(meta.poseChatId);
  if (!poseIds.length || !Number.isFinite(chatId)) return;
  if (meta.status === "ready" && meta.poseSent === true) {
    await finishJob(job.id);
    return;
  }

  const girlKey = typeof meta.poseGirlKey === "string" ? meta.poseGirlKey : "";
  const manKey = typeof meta.poseManKey === "string" ? meta.poseManKey : "";
  const cursor = typeof meta.poseCursor === "string" ? meta.poseCursor : "";
  const promptId = parseMeta(job.metaJson).comfyPromptId;
  const saved = clipsOf(meta);

  await withGpuJobContext(
    { jobId: job.id, comfyUrl: job.worker?.comfyUrl || null },
    async () => {
      const clips = saved.slice();
      if (
        cursor &&
        !clips.some((c) => c.poseId === cursor) &&
        typeof promptId === "string" &&
        promptId
      ) {
        try {
          const hist = await comfyWaitHistory(promptId, 25 * 60 * 1000);
          const file =
            hist.files.find((f) => /\.mp4$/i.test(f.filename)) || hist.files[0];
          if (!file) throw new Error("пустой файл");
          const bytes = await comfyDownloadImage(file);
          const { saveGalleryBinary } = await import("@/lib/local-store");
          const stored = saveGalleryBinary(item.userId, "mp4", bytes, "pose_clip");
          clips.push({
            poseId: cursor,
            fileKey: stored.relKey,
            title: poseById(cursor)?.title || cursor,
          });
          await mergePoseItemMeta(item.id, { poseClips: clips, poseCursor: "" });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.error(`[pose] resume ${cursor} failed: ${msg}`);
        }
      }

      const done = new Set(clips.map((c) => c.poseId));
      const girlAbs = girlKey ? resolveGalleryFile(girlKey) : null;
      const manAbs = manKey ? resolveGalleryFile(manKey) : null;
      if (girlAbs && fs.existsSync(girlAbs)) {
        const girlName = await comfyUploadImage(
          "pose_girl.jpg",
          fs.readFileSync(girlAbs),
          "image/jpeg",
        );
        let manName = POSE_DEFAULT_MAN;
        if (manAbs && fs.existsSync(manAbs)) {
          manName = await comfyUploadImage(
            "pose_man.jpg",
            fs.readFileSync(manAbs),
            "image/jpeg",
          );
        }
        for (const id of poseIds) {
          if (done.has(id)) continue;
          if (!(await beat(job.id))) return;
          try {
            await mergePoseItemMeta(item.id, { poseCursor: id });
            const out = await runComfyJob(
              buildPoseClipGraph({
                girlImage: girlName,
                manImage: manName,
                poseId: id,
                seed: Math.floor(Math.random() * 1_000_000_000),
              }),
              `pose-${id}`,
            );
            if (!out.bytes?.length) throw new Error("пустой файл");
            const { saveGalleryBinary } = await import("@/lib/local-store");
            const stored = saveGalleryBinary(item.userId, "mp4", out.bytes, "pose_clip");
            clips.push({
              poseId: id,
              fileKey: stored.relKey,
              title: poseById(id)?.title || id,
            });
            done.add(id);
            await mergePoseItemMeta(item.id, { poseClips: clips, poseCursor: "" });
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.error(`[pose] resume ${id} failed: ${msg}`);
          }
        }
      }

      const buffers: Buffer[] = [];
      const okTitles: string[] = [];
      for (const clip of clips) {
        const abs = resolveGalleryFile(clip.fileKey);
        if (!abs || !fs.existsSync(abs)) continue;
        buffers.push(fs.readFileSync(abs));
        okTitles.push(clip.title);
      }
      const failTitles = poseIds
        .filter((id) => !clips.some((c) => c.poseId === id))
        .map((id) => poseById(id)?.title || id);
      const per = await posePriceRub();
      const quoteRub = Math.max(
        0,
        Math.round(Number(meta.chargedPeaches) || poseIds.length * per),
      );
      await deliverPoseFilm({
        chatId,
        userId: item.userId,
        itemId: item.id,
        quoteRub,
        per,
        clips: buffers,
        okTitles,
        failTitles,
      });
      await finishJob(job.id);
    },
  );
}

async function finishJob(jobId: string) {
  await prisma.gpuJob.update({
    where: { id: jobId },
    data: { status: "done", stage: "done", finishedAt: new Date(), error: null },
  });
  await prisma.gpuWorker.updateMany({
    where: { currentJobId: jobId },
    data: { currentJobId: null, status: "online" },
  });
}

async function claimStale(jobId: string): Promise<boolean> {
  const job = await prisma.gpuJob.findUnique({
    where: { id: jobId },
    select: { status: true, metaJson: true },
  });
  if (!job || job.status !== "running") return false;
  const meta = parseMeta(job.metaJson);
  const beatAt = Date.parse(String(meta.lastBeatAt || ""));
  const lockUntil = Date.parse(String(meta.poseLockUntil || ""));
  if (Number.isFinite(beatAt) && Date.now() - beatAt < STALE_MS) return false;
  if (Number.isFinite(lockUntil) && lockUntil > Date.now()) return false;
  const next = {
    ...meta,
    lastBeatAt: new Date().toISOString(),
    poseLockUntil: new Date(Date.now() + LOCK_MS).toISOString(),
  };
  const claimed = await prisma.gpuJob.updateMany({
    where: { id: jobId, status: "running", metaJson: job.metaJson },
    data: { stage: "resume", metaJson: JSON.stringify(next) },
  });
  return claimed.count === 1;
}

export async function watchInterruptedPoseFilms(): Promise<void> {
  const jobs = await prisma.gpuJob.findMany({
    where: {
      pool: "pose",
      status: "running",
      refType: "galleryItem",
    },
    select: {
      id: true,
      refId: true,
      metaJson: true,
      worker: { select: { comfyUrl: true } },
    },
    take: 10,
  });
  for (const job of jobs) {
    if (!job.refId) continue;
    void (async () => {
      const deadline = Date.now() + 3 * 60 * 60 * 1000;
      while (Date.now() < deadline) {
        const live = await prisma.gpuJob.findUnique({
          where: { id: job.id },
          select: { status: true },
        });
        if (!live || live.status !== "running") return;
        if (await claimStale(job.id)) {
          const fresh = await prisma.gpuJob.findUnique({
            where: { id: job.id },
            select: {
              id: true,
              refId: true,
              metaJson: true,
              worker: { select: { comfyUrl: true } },
            },
          });
          if (!fresh?.refId) return;
          try {
            await continuePoseJob(fresh);
          } catch (e) {
            console.error(
              `[pose] resume ${job.id}:`,
              e instanceof Error ? e.message : e,
            );
          }
          return;
        }
        await new Promise((r) => setTimeout(r, 20_000));
      }
    })();
  }
}
