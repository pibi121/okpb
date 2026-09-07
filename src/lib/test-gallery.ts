/**
 * Test gallery: folders of pose stills (3 orientations) for keep/drop rating.
 */
import { after } from "next/server";
import { prisma } from "@/lib/db";
import { backupDatabase, saveGalleryBinary } from "@/lib/local-store";
import { enqueueGpuJob } from "@/lib/gallery-jobs";
import { generatePhotoBytes } from "@/lib/peach-lab";
import { loadPromptTemplates } from "@/lib/prompt-templates";
import { formatLegoTab } from "@/lib/prompt-lego-core";
import {
  kreaStillSize,
  type VideoOrientationId,
} from "@/lib/video-orientation";

export const TEST_GALLERY_ORIENTS: VideoOrientationId[] = ["9_16", "1_1", "16_9"];

export type TestGalleryRating = -1 | 0 | 1;

export function orientLabel(id: string) {
  if (id === "9_16") return "Вертикаль";
  if (id === "1_1") return "Квадрат";
  if (id === "16_9") return "Горизонт";
  return id;
}

export async function listTestGalleryFolders(userId: string) {
  const folders = await prisma.testGalleryFolder.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { shots: true } },
      shots: {
        select: { status: true, rating: true },
      },
    },
  });
  return folders.map((f) => {
    const ready = f.shots.filter((s) => s.status === "ready").length;
    const pending = f.shots.filter((s) => s.status === "pending").length;
    const errors = f.shots.filter((s) => s.status === "error").length;
    const rated = f.shots.filter((s) => s.rating === -1 || s.rating === 0 || s.rating === 1).length;
    return {
      id: f.id,
      slug: f.slug,
      title: f.title,
      kind: f.kind,
      characterId: f.characterId,
      status: f.status,
      error: f.error,
      createdAt: f.createdAt.toISOString(),
      total: f._count.shots,
      ready,
      pending,
      errors,
      rated,
    };
  });
}

export async function getTestGalleryFolder(userId: string, folderId: string) {
  const folder = await prisma.testGalleryFolder.findFirst({
    where: { id: folderId, userId },
    include: {
      shots: { orderBy: [{ sortIndex: "asc" }, { createdAt: "asc" }] },
    },
  });
  if (!folder) return null;
  const character = folder.characterId
    ? await prisma.character.findFirst({
        where: { id: folder.characterId, userId },
        select: { id: true, name: true, triggerWord: true },
      })
    : null;
  return {
    id: folder.id,
    slug: folder.slug,
    title: folder.title,
    kind: folder.kind,
    status: folder.status,
    error: folder.error,
    characterId: folder.characterId,
    character,
    createdAt: folder.createdAt.toISOString(),
    shots: folder.shots.map((s) => ({
      id: s.id,
      poseId: s.poseId,
      poseLabel: s.poseLabel,
      orientation: s.orientation,
      width: s.width,
      height: s.height,
      status: s.status,
      resultUrl: s.resultUrl,
      engine: s.engine,
      error: s.error,
      rating: s.rating,
      sortIndex: s.sortIndex,
      prompt: s.prompt,
    })),
  };
}

/** Create (or reuse) Lora+Pose folder and enqueue all poses × 3 orients. */
export async function startLoraPoseTestFolder(opts: {
  userId: string;
  characterId: string;
  /** Force recreate shots even if folder exists */
  recreate?: boolean;
}) {
  const character = await prisma.character.findFirst({
    where: { id: opts.characterId, userId: opts.userId },
  });
  if (!character) throw new Error("Персонаж не найден");

  const slug = "lora-pose";
  const title = "Lora + Pose";
  const poses = loadPromptTemplates().poses;
  if (!poses.length) throw new Error("Список поз пуст");

  let folder = await prisma.testGalleryFolder.findUnique({
    where: { userId_slug: { userId: opts.userId, slug } },
  });

  if (folder && opts.recreate) {
    await prisma.testGalleryShot.deleteMany({ where: { folderId: folder.id } });
    await prisma.testGalleryFolder.update({
      where: { id: folder.id },
      data: {
        characterId: character.id,
        status: "pending",
        error: null,
        title,
      },
    });
  } else if (!folder) {
    folder = await prisma.testGalleryFolder.create({
      data: {
        userId: opts.userId,
        slug,
        title,
        characterId: character.id,
        kind: "lora_pose",
        status: "pending",
      },
    });
  } else {
    const pendingOrEmpty = await prisma.testGalleryShot.count({
      where: { folderId: folder.id },
    });
    if (pendingOrEmpty > 0) {
      // Resume unfinished folder
      try {
        after(() => {
          void runTestGalleryFolder(folder!.id, opts.userId);
        });
      } catch {
        /* outside Next request */
      }
      return getTestGalleryFolder(opts.userId, folder.id);
    }
  }

  const rows: Array<{
    folderId: string;
    poseId: string;
    poseLabel: string;
    orientation: string;
    width: number;
    height: number;
    seed: string;
    sortIndex: number;
    status: string;
  }> = [];
  let sortIndex = 0;
  for (const pose of poses) {
    for (const orient of TEST_GALLERY_ORIENTS) {
      const size = kreaStillSize(orient);
      rows.push({
        folderId: folder!.id,
        poseId: pose.id,
        poseLabel: pose.label,
        orientation: orient,
        width: size.width,
        height: size.height,
        seed: String(Math.floor(Math.random() * 1e15)),
        sortIndex: sortIndex++,
        status: "pending",
      });
    }
  }

  await prisma.testGalleryShot.createMany({ data: rows });
  await prisma.testGalleryFolder.update({
    where: { id: folder!.id },
    data: { status: "running", error: null, characterId: character.id },
  });
  backupDatabase("test-gallery-pending");

  // Next request context: continue after response. CLI must call resumeTestGalleryFolder.
  try {
    after(() => {
      void runTestGalleryFolder(folder!.id, opts.userId);
    });
  } catch {
    /* outside Next request — no after() */
  }

  return getTestGalleryFolder(opts.userId, folder!.id);
}

/** Resume / run pending shots (also used by CLI scripts). */
export async function resumeTestGalleryFolder(folderId: string, userId: string) {
  return runTestGalleryFolder(folderId, userId);
}

async function runTestGalleryFolder(folderId: string, userId: string) {
  const folder = await prisma.testGalleryFolder.findFirst({
    where: { id: folderId, userId },
  });
  if (!folder?.characterId) return;

  const character = await prisma.character.findFirst({
    where: { id: folder.characterId, userId },
  });
  if (!character) return;

  await prisma.testGalleryFolder.update({
    where: { id: folderId },
    data: { status: "running", error: null },
  });

  const shots = await prisma.testGalleryShot.findMany({
    where: { folderId, status: "pending" },
    orderBy: { sortIndex: "asc" },
  });

  for (const shot of shots) {
    await enqueueGpuJob(async () => {
      const fresh = await prisma.testGalleryShot.findFirst({
        where: { id: shot.id, status: "pending" },
      });
      if (!fresh) return;
      try {
        const legoQuery = `${formatLegoTab(character.name)} ${formatLegoTab(shot.poseLabel)}`;
        const seed = Number(fresh.seed);
        const out = await generatePhotoBytes({
          userId,
          characterId: character.id,
          characterIds: [character.id],
          title: `Test · ${shot.poseLabel} · ${orientLabel(shot.orientation)}`,
          poseId: shot.poseId,
          usePreset: true,
          legoQuery,
          width: shot.width,
          height: shot.height,
          seed: Number.isFinite(seed) ? seed : undefined,
          useCharacterLora: character.loraStatus === "lora_ready",
          skinDetail: false,
          skinDetailStrength: 0,
        });
        const saved = saveGalleryBinary(userId, "png", out.bytes, "testgal");
        await prisma.testGalleryShot.update({
          where: { id: shot.id },
          data: {
            status: "ready",
            resultUrl: saved.publicUrl,
            engine: out.engine,
            prompt: out.prompt,
            error: null,
          },
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "ошибка генерации";
        console.error("[peach] test-gallery shot failed:", shot.poseId, e);
        await prisma.testGalleryShot.update({
          where: { id: shot.id },
          data: { status: "error", error: msg },
        });
      }
    });
  }

  const left = await prisma.testGalleryShot.count({
    where: { folderId, status: "pending" },
  });
  const ready = await prisma.testGalleryShot.count({
    where: { folderId, status: "ready" },
  });
  await prisma.testGalleryFolder.update({
    where: { id: folderId },
    data: {
      status: ready ? (left ? "running" : "ready") : left ? "running" : "error",
      error: ready || left ? null : "все кадры упали",
    },
  });
  backupDatabase("test-gallery-done");
}

export async function rateTestGalleryShot(
  userId: string,
  shotId: string,
  rating: TestGalleryRating | null,
) {
  const shot = await prisma.testGalleryShot.findFirst({
    where: { id: shotId, folder: { userId } },
  });
  if (!shot) throw new Error("shot not found");
  await prisma.testGalleryShot.update({
    where: { id: shotId },
    data: { rating },
  });
  backupDatabase("test-gallery-rate");
  return prisma.testGalleryShot.findUniqueOrThrow({ where: { id: shotId } });
}

/** Pose-level summary for keep/drop decisions. */
export function summarizePoseRatings(
  shots: Array<{
    poseId: string;
    poseLabel: string;
    status: string;
    rating: number | null;
  }>,
) {
  const map = new Map<
    string,
    {
      poseId: string;
      poseLabel: string;
      ready: number;
      bad: number;
      neutral: number;
      good: number;
      unrated: number;
    }
  >();
  for (const s of shots) {
    let b = map.get(s.poseId);
    if (!b) {
      b = {
        poseId: s.poseId,
        poseLabel: s.poseLabel,
        ready: 0,
        bad: 0,
        neutral: 0,
        good: 0,
        unrated: 0,
      };
      map.set(s.poseId, b);
    }
    if (s.status !== "ready") continue;
    b.ready += 1;
    if (s.rating === -1) b.bad += 1;
    else if (s.rating === 0) b.neutral += 1;
    else if (s.rating === 1) b.good += 1;
    else b.unrated += 1;
  }
  return [...map.values()];
}
