import { after } from "next/server";
import { prisma } from "@/lib/db";
import { backupDatabase, saveGalleryBinary } from "@/lib/local-store";
import { runWanAnimate2FromUrls } from "@/lib/motion-lab";
import {
  WAN_ANIMATE2_DEFAULT_NEGATIVE,
  WAN_ANIMATE2_DEFAULT_POSITIVE,
} from "@/lib/video-graphs";

export type PublicMotionTemplate = {
  id: string;
  title: string;
  notes: string;
  drivingVideoUrl: string;
  referenceImageUrl: string;
  resultVideoUrl: string;
  positivePrompt: string;
  negativePrompt: string;
  width: number;
  height: number;
  frameCount: number;
  fps: number;
  status: string;
  published: boolean;
  error: string | null;
  engine: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PublicMotionRun = {
  id: string;
  templateId: string;
  characterId: string | null;
  referenceImageUrl: string;
  resultVideoUrl: string;
  status: string;
  error: string | null;
  engine: string | null;
  createdAt: string;
};

function toPublicTemplate(row: {
  id: string;
  title: string;
  notes: string;
  drivingVideoUrl: string;
  referenceImageUrl: string;
  resultVideoUrl: string;
  positivePrompt: string;
  negativePrompt: string;
  width: number;
  height: number;
  frameCount: number;
  fps: number;
  status: string;
  published: boolean;
  error: string | null;
  engine: string | null;
  createdAt: Date;
  updatedAt: Date;
}): PublicMotionTemplate {
  return {
    id: row.id,
    title: row.title,
    notes: row.notes,
    drivingVideoUrl: row.drivingVideoUrl,
    referenceImageUrl: row.referenceImageUrl,
    resultVideoUrl: row.resultVideoUrl,
    positivePrompt: row.positivePrompt,
    negativePrompt: row.negativePrompt,
    width: row.width,
    height: row.height,
    frameCount: row.frameCount,
    fps: row.fps,
    status: row.status,
    published: row.published,
    error: row.error,
    engine: row.engine,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listMotionTemplates(userId: string, opts?: { publishedOnly?: boolean }) {
  const rows = await prisma.motionTemplate.findMany({
    where: opts?.publishedOnly
      ? { OR: [{ published: true }, { userId }] }
      : { userId },
    orderBy: { updatedAt: "desc" },
    take: 50,
  });
  return rows.map(toPublicTemplate);
}

export async function getMotionTemplate(userId: string, id: string) {
  const row = await prisma.motionTemplate.findFirst({
    where: { id, OR: [{ userId }, { published: true }] },
  });
  return row ? toPublicTemplate(row) : null;
}

export async function createMotionTemplate(
  userId: string,
  opts: {
    title: string;
    notes?: string;
    drivingVideoUrl?: string;
    referenceImageUrl?: string;
    positivePrompt?: string;
    negativePrompt?: string;
    width?: number;
    height?: number;
    frameCount?: number;
    fps?: number;
  },
) {
  const row = await prisma.motionTemplate.create({
    data: {
      userId,
      title: opts.title.trim() || "Motion template",
      notes: opts.notes?.trim() || "",
      drivingVideoUrl: opts.drivingVideoUrl || "",
      referenceImageUrl: opts.referenceImageUrl || "",
      positivePrompt: opts.positivePrompt?.trim() || WAN_ANIMATE2_DEFAULT_POSITIVE,
      negativePrompt: opts.negativePrompt?.trim() || WAN_ANIMATE2_DEFAULT_NEGATIVE,
      width: opts.width ?? 832,
      height: opts.height ?? 480,
      frameCount: opts.frameCount ?? 81,
      fps: opts.fps ?? 16,
      status: "draft",
    },
  });
  backupDatabase("motion-create");
  return toPublicTemplate(row);
}

export async function updateMotionTemplate(
  userId: string,
  id: string,
  patch: Partial<{
    title: string;
    notes: string;
    drivingVideoUrl: string;
    referenceImageUrl: string;
    positivePrompt: string;
    negativePrompt: string;
    width: number;
    height: number;
    frameCount: number;
    fps: number;
    published: boolean;
  }>,
) {
  const existing = await prisma.motionTemplate.findFirst({ where: { id, userId } });
  if (!existing) throw new Error("not found");
  const row = await prisma.motionTemplate.update({
    where: { id },
    data: {
      ...(patch.title != null ? { title: patch.title.trim() } : {}),
      ...(patch.notes != null ? { notes: patch.notes } : {}),
      ...(patch.drivingVideoUrl != null ? { drivingVideoUrl: patch.drivingVideoUrl } : {}),
      ...(patch.referenceImageUrl != null
        ? { referenceImageUrl: patch.referenceImageUrl }
        : {}),
      ...(patch.positivePrompt != null ? { positivePrompt: patch.positivePrompt } : {}),
      ...(patch.negativePrompt != null ? { negativePrompt: patch.negativePrompt } : {}),
      ...(patch.width != null ? { width: patch.width } : {}),
      ...(patch.height != null ? { height: patch.height } : {}),
      ...(patch.frameCount != null ? { frameCount: patch.frameCount } : {}),
      ...(patch.fps != null ? { fps: patch.fps } : {}),
      ...(patch.published != null ? { published: patch.published } : {}),
    },
  });
  return toPublicTemplate(row);
}

async function setTemplateStatus(
  id: string,
  data: Record<string, unknown>,
) {
  await prisma.motionTemplate.update({ where: { id }, data });
}

export async function enqueueMotionTemplateGenerate(userId: string, id: string) {
  const tpl = await prisma.motionTemplate.findFirst({ where: { id, userId } });
  if (!tpl) throw new Error("not found");
  if (!tpl.drivingVideoUrl) throw new Error("Загрузи driving-видео");
  if (!tpl.referenceImageUrl) throw new Error("Загрузи reference-фото (Krea)");
  if (tpl.status === "generating") throw new Error("уже генерируется");

  await setTemplateStatus(id, { status: "generating", error: null });

  after(() => {
    void (async () => {
      try {
        const out = await runWanAnimate2FromUrls({
          referenceImageUrl: tpl.referenceImageUrl,
          drivingVideoUrl: tpl.drivingVideoUrl,
          positive: tpl.positivePrompt,
          negative: tpl.negativePrompt,
          filenamePrefix: `peach/motion/${id}`,
          autoFit: true,
        });
        const saved = saveGalleryBinary(userId, "mp4", out.bytes, `motion_${id}`);
        await prisma.galleryItem.create({
          data: {
            userId,
            kind: "video",
            title: `${tpl.title} · motion preview`,
            prompt: tpl.positivePrompt,
            resultUrl: saved.publicUrl,
            width: out.width,
            height: out.height,
            metaJson: JSON.stringify({
              status: "ready",
              motionTemplateId: id,
              engine: out.engine,
              galleryDir: process.cwd(),
              localKey: saved.relKey,
              wanAnimate2: true,
              frameCount: out.frameCount,
              fps: out.fps,
            }),
          },
        });
        await setTemplateStatus(id, {
          status: "ready",
          resultVideoUrl: saved.publicUrl,
          engine: out.engine,
          width: out.width,
          height: out.height,
          frameCount: out.frameCount,
          fps: out.fps,
          error: null,
        });
        backupDatabase("motion-gen");
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("[peach] motion template generate failed:", msg);
        await setTemplateStatus(id, { status: "error", error: msg });
      }
    })();
  });

  return getMotionTemplate(userId, id);
}

export async function enqueueMotionRun(opts: {
  userId: string;
  templateId: string;
  referenceImageUrl: string;
  characterId?: string | null;
  positivePrompt?: string;
  negativePrompt?: string;
}) {
  const tpl = await prisma.motionTemplate.findFirst({
    where: {
      id: opts.templateId,
      OR: [{ userId: opts.userId }, { published: true }],
    },
  });
  if (!tpl) throw new Error("шаблон не найден");
  if (!tpl.drivingVideoUrl) throw new Error("у шаблона нет driving-видео");
  if (!opts.referenceImageUrl) throw new Error("нужно фото персонажа");

  const run = await prisma.motionRun.create({
    data: {
      userId: opts.userId,
      templateId: tpl.id,
      characterId: opts.characterId || null,
      referenceImageUrl: opts.referenceImageUrl,
      positivePrompt: opts.positivePrompt?.trim() || tpl.positivePrompt,
      negativePrompt: opts.negativePrompt?.trim() || tpl.negativePrompt,
      status: "busy",
    },
  });

  after(() => {
    void (async () => {
      try {
        const out = await runWanAnimate2FromUrls({
          referenceImageUrl: opts.referenceImageUrl,
          drivingVideoUrl: tpl.drivingVideoUrl,
          positive: run.positivePrompt,
          negative: run.negativePrompt,
          filenamePrefix: `peach/motion-run/${run.id}`,
          autoFit: true,
        });
        const saved = saveGalleryBinary(
          opts.userId,
          "mp4",
          out.bytes,
          `motion_run_${run.id}`,
        );
        await prisma.galleryItem.create({
          data: {
            userId: opts.userId,
            characterId: opts.characterId || null,
            kind: "video",
            title: `${tpl.title} · social`,
            prompt: run.positivePrompt,
            resultUrl: saved.publicUrl,
            width: out.width,
            height: out.height,
            metaJson: JSON.stringify({
              status: "ready",
              motionRunId: run.id,
              motionTemplateId: tpl.id,
              engine: out.engine,
              localKey: saved.relKey,
              wanAnimate2: true,
            }),
          },
        });
        await prisma.motionRun.update({
          where: { id: run.id },
          data: {
            status: "ready",
            resultVideoUrl: saved.publicUrl,
            engine: out.engine,
            error: null,
          },
        });
        backupDatabase("motion-run");
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("[peach] motion run failed:", msg);
        await prisma.motionRun.update({
          where: { id: run.id },
          data: { status: "error", error: msg },
        });
      }
    })();
  });

  return {
    id: run.id,
    templateId: run.templateId,
    characterId: run.characterId,
    referenceImageUrl: run.referenceImageUrl,
    resultVideoUrl: "",
    status: "busy",
    error: null,
    engine: null,
    createdAt: run.createdAt.toISOString(),
  } satisfies PublicMotionRun;
}

export async function listMotionRuns(userId: string, templateId?: string) {
  const rows = await prisma.motionRun.findMany({
    where: { userId, ...(templateId ? { templateId } : {}) },
    orderBy: { createdAt: "desc" },
    take: 30,
  });
  return rows.map(
    (r): PublicMotionRun => ({
      id: r.id,
      templateId: r.templateId,
      characterId: r.characterId,
      referenceImageUrl: r.referenceImageUrl,
      resultVideoUrl: r.resultVideoUrl,
      status: r.status,
      error: r.error,
      engine: r.engine,
      createdAt: r.createdAt.toISOString(),
    }),
  );
}
