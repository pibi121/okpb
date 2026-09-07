import { prisma } from "@/lib/db";
import { parseJsonArray } from "@/lib/film-project";
import { parseGalleryMeta } from "@/lib/gallery-meta";
import { enqueueAnimateJob, enqueuePhotoJob } from "@/lib/gallery-jobs";
import { composeVideoPromptLLM } from "@/lib/prompt-composer-llm";
import { sceneFromTemplateStillPrompt } from "@/lib/template-scene";
import { ensurePackCharacterIds, loadCharacterSlots } from "@/lib/template-pack";
import type {
  PlayStep,
  PlayablePackSummary,
  PublicPlayFrame,
  PublicPlayRun,
} from "@/lib/template-play-types";

export type { PlayStep, PlayablePackSummary, PublicPlayFrame, PublicPlayRun };

async function mediaMap(ids: string[]) {
  const uniq = [...new Set(ids.filter(Boolean))];
  if (!uniq.length) return new Map<string, { url: string; status: string; error: string | null }>();
  const items = await prisma.galleryItem.findMany({ where: { id: { in: uniq } } });
  const map = new Map<string, { url: string; status: string; error: string | null }>();
  for (const it of items) {
    const meta = parseGalleryMeta(it.metaJson);
    const status = meta.status === "pending" || meta.status === "error" ? meta.status : "ready";
    map.set(it.id, {
      url: it.resultUrl,
      status,
      error: typeof meta.error === "string" ? meta.error : null,
    });
  }
  return map;
}

export async function listPlayablePacks(userId: string): Promise<PlayablePackSummary[]> {
  const packs = await prisma.templatePack.findMany({
    where: { userId, frames: { some: {} } },
    include: { frames: true },
    orderBy: { updatedAt: "desc" },
  });
  return packs.map((p) => ({
    id: p.id,
    title: p.title,
    status: p.status,
    frameCount: p.frames.length,
    coverStillUrl: p.coverStillUrl,
    idea: p.idea,
  }));
}

export async function listUserRuns(userId: string): Promise<
  Array<{ id: string; packTitle: string; step: string; updatedAt: string; frameCount: number }>
> {
  const runs = await prisma.templateRun.findMany({
    where: { userId },
    include: { pack: { select: { title: true } }, frames: true },
    orderBy: { updatedAt: "desc" },
    take: 12,
  });
  return runs.map((r) => ({
    id: r.id,
    packTitle: r.pack.title,
    step: r.step,
    updatedAt: r.updatedAt.toISOString(),
    frameCount: r.frames.length,
  }));
}

export async function toPublicRun(runId: string): Promise<PublicPlayRun | null> {
  const run = await prisma.templateRun.findUnique({
    where: { id: runId },
    include: {
      pack: { include: { frames: { orderBy: { index: "asc" } } } },
      frames: { orderBy: { index: "asc" } },
    },
  });
  if (!run) return null;

  const ids = run.frames.flatMap((f) => [f.stillItemId, f.clipItemId]).filter(Boolean) as string[];
  const media = await mediaMap(ids);
  const packFrames = new Map(run.pack.frames.map((f) => [f.id, f]));
  const packCharacterIds = await ensurePackCharacterIds(run.pack);
  const suggestedCount = Math.max(1, packCharacterIds.length || 2);
  const characterSlots = await loadCharacterSlots(packCharacterIds);

  const frames: PublicPlayFrame[] = run.frames.map((f) => {
    const src = packFrames.get(f.templateFrameId);
    const still = f.stillItemId ? media.get(f.stillItemId) : undefined;
    const clip = f.clipItemId ? media.get(f.clipItemId) : undefined;
    return {
      id: f.id,
      templateFrameId: f.templateFrameId,
      index: f.index,
      title: src?.title || "",
      beat: src?.beat || "",
      never: src?.never || "",
      scenePrompt: sceneFromTemplateStillPrompt(src?.stillPrompt || "", src?.beat),
      durationSec: f.durationSec,
      poseId: src?.poseId || null,
      soloCharacterIndex: (src as { soloCharacterIndex?: number | null } | undefined)?.soloCharacterIndex ?? null,
      clothed: (src as { clothed?: boolean } | undefined)?.clothed ?? false,
      stillItemId: f.stillItemId,
      clipItemId: f.clipItemId,
      videoNote: f.videoNote,
      dialogue: f.dialogue,
      videoPrompt: f.videoPrompt,
      stillUrl: still?.status === "ready" ? still.url : null,
      clipUrl: clip?.status === "ready" ? clip.url : null,
      stillError: still?.status === "error" ? still.error || "ошибка кадра" : null,
      clipError: clip?.status === "error" ? clip.error || "ошибка клипа" : null,
      stillStatus:
        still?.status === "pending" || still?.status === "ready" || still?.status === "error"
          ? still.status
          : "none",
      clipStatus:
        clip?.status === "pending" || clip?.status === "ready" || clip?.status === "error"
          ? clip.status
          : "none",
    };
  });

  const characterIds = parseJsonArray(run.characterIdsJson);
  const stillsReady = frames.length > 0 && frames.every((f) => f.stillStatus === "ready");
  const clipsReady = frames.length > 0 && frames.every((f) => f.clipStatus === "ready");
  let step = run.step as PlayStep;
  if (step === "stills" && stillsReady) step = "animate";
  if (step === "animate" && clipsReady) step = "done";
  if (step !== run.step) {
    await prisma.templateRun.update({ where: { id: runId }, data: { step } });
  }

  return {
    id: run.id,
    packId: run.packId,
    packTitle: run.pack.title,
    packIdea: run.pack.idea,
    packCover: run.pack.coverStillUrl,
    step,
    characterIds,
    suggestedCount,
    characterSlots,
    frames,
    createdAt: run.createdAt.toISOString(),
    updatedAt: run.updatedAt.toISOString(),
  };
}

export async function getOwnedRun(userId: string, runId: string) {
  return prisma.templateRun.findFirst({ where: { id: runId, userId } });
}

export async function startTemplatePlay(userId: string, packId: string) {
  const pack = await prisma.templatePack.findFirst({
    where: { id: packId, userId },
    include: { frames: { orderBy: { index: "asc" } } },
  });
  if (!pack) throw new Error("Шаблон не найден");
  if (!pack.frames.length) throw new Error("В шаблоне нет кадров");

  const run = await prisma.templateRun.create({
    data: {
      userId,
      packId,
      step: "characters",
      frames: {
        create: pack.frames.map((f) => ({
          templateFrameId: f.id,
          index: f.index,
          dialogue: f.dialogue || "",
          durationSec: f.durationSec || 6,
          videoNote: "",
        })),
      },
    },
  });
  const publicRun = await toPublicRun(run.id);
  if (!publicRun) throw new Error("Не удалось открыть прогон");
  return publicRun;
}

export async function setRunCharacters(userId: string, runId: string, characterIds: string[]) {
  const run = await getOwnedRun(userId, runId);
  if (!run) throw new Error("not found");
  const uniq = [...new Set(characterIds.filter(Boolean))].slice(0, 4);
  if (!uniq.length) throw new Error("Выбери хотя бы одного персонажа");

  const owned = await prisma.character.findMany({
    where: { id: { in: uniq }, userId },
    select: { id: true },
  });
  if (owned.length !== uniq.length) throw new Error("Персонаж не найден");

  await prisma.templateRun.update({
    where: { id: runId },
    data: {
      characterIdsJson: JSON.stringify(uniq),
      step: "stills",
    },
  });
  return toPublicRun(runId);
}

export async function generateRunStills(userId: string, runId: string) {
  const run = await prisma.templateRun.findFirst({
    where: { id: runId, userId },
    include: {
      pack: { include: { frames: true } },
      frames: { orderBy: { index: "asc" } },
    },
  });
  if (!run) throw new Error("not found");
  const characterIds = parseJsonArray(run.characterIdsJson);
  if (!characterIds.length) throw new Error("Сначала выбери персонажей");

  const packFrames = new Map(run.pack.frames.map((f) => [f.id, f]));
  for (const frame of run.frames) {
    if (frame.stillItemId) {
      const existing = await prisma.galleryItem.findFirst({
        where: { id: frame.stillItemId, userId },
      });
      const st = existing ? parseGalleryMeta(existing.metaJson).status : null;
      if (st === "pending" || st === "ready") continue;
    }
    const src = packFrames.get(frame.templateFrameId);
    const scene = sceneFromTemplateStillPrompt(src?.stillPrompt || "", src?.beat);
    const neverText = src?.never?.trim() || "";
    if (!scene.trim()) throw new Error(`Кадр #${frame.index + 1}: нет описания сцены`);

    // Determine which characters appear in this frame
    const soloIdx = (src as { soloCharacterIndex?: number | null } | undefined)?.soloCharacterIndex ?? null;
    const frameClothed = (src as { clothed?: boolean } | undefined)?.clothed ?? false;
    let frameCharacterIds: string[];
    if (soloIdx !== null && soloIdx >= 0 && soloIdx < characterIds.length) {
      frameCharacterIds = [characterIds[soloIdx]!];
    } else {
      frameCharacterIds = characterIds;
    }
    const hasMale = frameCharacterIds.length > 1;

    const item = await enqueuePhotoJob(userId, {
      userId,
      characterId: frameCharacterIds[0],
      characterIds: frameCharacterIds,
      title: `${run.pack.title} · сцена ${frame.index + 1}`,
      userNote: scene,
      never: neverText,
      poseId: src?.poseId || undefined,
      usePreset: true,
      clothed: frameClothed,
      includeMale: hasMale,
      templateRunFrameId: frame.id,
    });
    await prisma.templateRunFrame.update({
      where: { id: frame.id },
      data: { stillItemId: item.id },
    });
  }

  await prisma.templateRun.update({
    where: { id: runId },
    data: { step: "stills", updatedAt: new Date() },
  });
  return toPublicRun(runId);
}

export async function updateRunFrame(
  userId: string,
  runId: string,
  frameId: string,
  patch: Partial<{ videoNote: string; dialogue: string; durationSec: number; videoPrompt: string }>,
) {
  const run = await getOwnedRun(userId, runId);
  if (!run) throw new Error("not found");
  const frame = await prisma.templateRunFrame.findFirst({ where: { id: frameId, runId } });
  if (!frame) throw new Error("Кадр не найден");

  await prisma.templateRunFrame.update({
    where: { id: frameId },
    data: {
      videoNote: patch.videoNote !== undefined ? patch.videoNote.trim() : undefined,
      dialogue: patch.dialogue !== undefined ? patch.dialogue.trim() : undefined,
      videoPrompt: patch.videoPrompt !== undefined ? patch.videoPrompt.trim() : undefined,
      durationSec: patch.durationSec,
    },
  });
  await prisma.templateRun.update({ where: { id: runId }, data: { updatedAt: new Date() } });
  return toPublicRun(runId);
}

export async function animateRunFrame(
  userId: string,
  runId: string,
  frameId: string,
  opts?: { withMusic?: boolean; compose?: boolean },
) {
  const run = await prisma.templateRun.findFirst({
    where: { id: runId, userId },
    include: {
      pack: { include: { frames: true } },
      frames: true,
    },
  });
  if (!run) throw new Error("not found");
  const frame = run.frames.find((f) => f.id === frameId);
  if (!frame) throw new Error("Кадр не найден");
  if (!frame.stillItemId) throw new Error("Сначала сгенерируй сцену");

  const still = await prisma.galleryItem.findFirst({
    where: { id: frame.stillItemId, userId, kind: "photo" },
  });
  if (!still) throw new Error("Фото сцены не найдено");
  const stillMeta = parseGalleryMeta(still.metaJson);
  if (stillMeta.status === "pending") throw new Error("Фото ещё генерируется");
  if (stillMeta.status === "error") throw new Error("Фото с ошибкой — перегенерируй сцену");

  const src = run.pack.frames.find((f) => f.id === frame.templateFrameId);
  const plot = [src?.beat, frame.videoNote].filter(Boolean).join("\n");
  let composed = frame.videoPrompt.trim();
  if (opts?.compose !== false || !composed) {
    composed = await composeVideoPromptLLM({
      stillPrompt: still.prompt || "",
      userNote: frame.videoNote || src?.beat || "",
      stillTitle: still.title,
      poseId: src?.poseId,
      durationSec: frame.durationSec,
      dialogue: frame.dialogue,
    });
    await prisma.templateRunFrame.update({
      where: { id: frame.id },
      data: { videoPrompt: composed },
    });
  }

  const item = await enqueueAnimateJob(
    userId,
    still.id,
    plot || src?.beat || "match the still pose",
    !!opts?.withMusic,
    composed,
    frame.durationSec,
    {
      poseId: src?.poseId,
      templateRunFrameId: frame.id,
      dialogue: frame.dialogue,
    },
  );
  await prisma.templateRunFrame.update({
    where: { id: frame.id },
    data: { clipItemId: item.id },
  });
  await prisma.templateRun.update({
    where: { id: runId },
    data: { step: "animate", updatedAt: new Date() },
  });
  return toPublicRun(runId);
}

export async function animateAllRunFrames(userId: string, runId: string) {
  const run = await prisma.templateRun.findFirst({
    where: { id: runId, userId },
    include: { frames: { orderBy: { index: "asc" } } },
  });
  if (!run) throw new Error("not found");
  for (const frame of run.frames) {
    if (!frame.stillItemId) continue;
    if (frame.clipItemId) {
      const clip = await prisma.galleryItem.findFirst({ where: { id: frame.clipItemId } });
      const st = clip ? parseGalleryMeta(clip.metaJson).status : null;
      if (st === "pending" || st === "ready") continue;
    }
    await animateRunFrame(userId, runId, frame.id, { compose: true });
  }
  return toPublicRun(runId);
}
