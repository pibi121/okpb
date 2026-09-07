import { prisma } from "@/lib/db";
import { parseGalleryMeta } from "@/lib/gallery-meta";
import { parseJsonArray } from "@/lib/film-project";
import { ollamaChat, ollamaPingWithRetry } from "@/lib/ollama-client";
import { photoKnowledgeExcerpt, videoKnowledgeExcerpt } from "@/lib/prompt-knowledge";
import { logKbEntry, logPublishedTemplateKb } from "@/lib/prompt-kb";
import { enqueueAnimateJob, enqueueTemplateStitchJob } from "@/lib/gallery-jobs";
import type {
  PublicTemplateFrame,
  PublicTemplatePack,
  TemplatePackSummary,
} from "@/lib/template-pack-types";

export type { PublicTemplateFrame, PublicTemplatePack, TemplatePackSummary } from "@/lib/template-pack-types";

async function findStitchItemId(userId: string, packId: string): Promise<string | null> {
  const films = await prisma.galleryItem.findMany({
    where: { userId, kind: "film" },
    orderBy: { createdAt: "desc" },
    take: 40,
    select: { id: true, metaJson: true },
  });
  for (const it of films) {
    const meta = parseGalleryMeta(it.metaJson);
    if (meta.templatePackId === packId && meta.jobAction === "template_stitch") return it.id;
  }
  return null;
}

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

function characterIdsFromGalleryItem(item: { characterId: string | null; metaJson: string }): string[] {
  const meta = parseGalleryMeta(item.metaJson);
  const fromMeta = Array.isArray(meta.characterIds)
    ? meta.characterIds.filter((x): x is string => typeof x === "string" && !!x.trim())
    : [];
  const ids = fromMeta.length ? fromMeta : item.characterId ? [item.characterId] : [];
  return [...new Set(ids)];
}

export async function loadCharacterSlots(ids: string[]) {
  const uniq = [...new Set(ids.filter(Boolean))];
  if (!uniq.length) return [] as Array<{ id: string; name: string; gender: string }>;
  const rows = await prisma.character.findMany({
    where: { id: { in: uniq } },
    select: { id: true, name: true, gender: true },
  });
  const byId = new Map(rows.map((c) => [c.id, c]));
  return uniq
    .map((id) => byId.get(id))
    .filter(Boolean)
    .map((c) => ({ id: c!.id, name: c!.name, gender: c!.gender }));
}

async function inferCharacterIdsFromStillIds(stillIds: string[]): Promise<string[]> {
  const uniq = [...new Set(stillIds.filter(Boolean))];
  if (!uniq.length) return [];
  const items = await prisma.galleryItem.findMany({
    where: { id: { in: uniq } },
    select: { id: true, characterId: true, metaJson: true },
  });
  const byId = new Map(items.map((it) => [it.id, it]));
  const ordered: string[] = [];
  for (const id of uniq) {
    const item = byId.get(id);
    if (!item) continue;
    for (const cid of characterIdsFromGalleryItem(item)) {
      if (!ordered.includes(cid)) ordered.push(cid);
    }
  }
  return ordered.slice(0, 4);
}

async function persistPackCharacterIds(packId: string, ids: string[]) {
  await prisma.templatePack.update({
    where: { id: packId },
    data: { characterIdsJson: JSON.stringify(ids.slice(0, 4)) },
  });
}

async function mergePackCharacterIds(packId: string, incoming: string[]) {
  if (!incoming.length) return;
  const pack = await prisma.templatePack.findUnique({
    where: { id: packId },
    select: { characterIdsJson: true },
  });
  if (!pack) return;
  const current = parseJsonArray(pack.characterIdsJson);
  const next = [...current];
  for (const id of incoming) {
    if (id && !next.includes(id)) next.push(id);
  }
  const sliced = next.slice(0, 4);
  if (JSON.stringify(sliced) !== JSON.stringify(current)) {
    await persistPackCharacterIds(packId, sliced);
  }
}

export async function ensurePackCharacterIds(pack: {
  id: string;
  characterIdsJson: string;
  frames?: Array<{ stillItemId: string | null }>;
}): Promise<string[]> {
  const existing = parseJsonArray(pack.characterIdsJson);
  if (existing.length) return existing;
  const stillIds = [...(pack.frames || [])]
    .sort((a, b) => (("index" in a ? Number(a.index) : 0) - ("index" in b ? Number(b.index) : 0)))
    .map((f) => f.stillItemId)
    .filter(Boolean) as string[];
  const inferred = await inferCharacterIdsFromStillIds(stillIds);
  if (inferred.length) await persistPackCharacterIds(pack.id, inferred);
  return inferred;
}

function frameReady(still?: { status: string }, clip?: { status: string }) {
  return still?.status === "ready" && clip?.status === "ready";
}

export async function toPublicPack(packId: string): Promise<PublicTemplatePack | null> {
  const pack = await prisma.templatePack.findUnique({
    where: { id: packId },
    include: { frames: { orderBy: { index: "asc" } } },
  });
  if (!pack) return null;

  const ids = pack.frames.flatMap((f) => [f.stillItemId, f.clipItemId]).filter(Boolean) as string[];
  const stitchItemId =
    (pack as { stitchItemId?: string | null }).stitchItemId ||
    (await findStitchItemId(pack.userId, packId));
  if (stitchItemId) ids.push(stitchItemId);
  const media = await mediaMap(ids);

  const frames: PublicTemplateFrame[] = pack.frames.map((f) => {
    const still = f.stillItemId ? media.get(f.stillItemId) : undefined;
    const clip = f.clipItemId ? media.get(f.clipItemId) : undefined;
    return {
      id: f.id,
      index: f.index,
      title: f.title,
      beat: f.beat,
      never: f.never,
      stillPrompt: f.stillPrompt,
      videoPrompt: f.videoPrompt,
      dialogue: f.dialogue || "",
      durationSec: f.durationSec,
      poseId: f.poseId,
      stillItemId: f.stillItemId,
      clipItemId: f.clipItemId,
      status: f.status,
      stillFailNote: f.stillFailNote,
      videoFailNote: f.videoFailNote,
      soloCharacterIndex: (f as { soloCharacterIndex?: number | null }).soloCharacterIndex ?? null,
      clothed: (f as { clothed?: boolean }).clothed ?? false,
      stillUrl: still?.status === "ready" ? still.url : null,
      clipUrl: clip?.status === "ready" ? clip.url : null,
      stillError: still?.status === "error" ? still.error || "ошибка кадра" : null,
      clipError: clip?.status === "error" ? clip.error || "ошибка клипа" : null,
      stillStatus: still?.status === "pending" || still?.status === "ready" || still?.status === "error"
        ? still.status
        : "none",
      clipStatus: clip?.status === "pending" || clip?.status === "ready" || clip?.status === "error"
        ? clip.status
        : "none",
    };
  });

  const approvedCount = frames.filter((f) => f.status === "approved").length;
  const stitch = stitchItemId ? media.get(stitchItemId) : undefined;
  const characterIds = await ensurePackCharacterIds(pack);
  const characterSlots = await loadCharacterSlots(characterIds);

  return {
    id: pack.id,
    title: pack.title,
    idea: pack.idea,
    tags: parseJsonArray(pack.tagsJson),
    characterIds,
    characterSlots,
    locationNote: pack.locationNote,
    status: pack.status as "assembling" | "published",
    searchText: pack.searchText,
    coverStillUrl: pack.coverStillUrl,
    publishedAt: pack.publishedAt?.toISOString() || null,
    createdAt: pack.createdAt.toISOString(),
    updatedAt: pack.updatedAt.toISOString(),
    frames,
    frameCount: frames.length,
    approvedCount,
    stitchItemId: stitchItemId || null,
    stitchUrl: stitch?.status === "ready" ? stitch.url : null,
    stitchStatus:
      stitch?.status === "pending" || stitch?.status === "ready" || stitch?.status === "error"
        ? stitch.status
        : "none",
    stitchError: stitch?.status === "error" ? stitch.error || "ошибка склейки" : null,
  };
}

export async function listTemplatePacks(userId: string): Promise<TemplatePackSummary[]> {
  const packs = await prisma.templatePack.findMany({
    where: { userId },
    include: { frames: true },
    orderBy: { updatedAt: "desc" },
  });
  const ids: string[] = [];
  const packIds: string[][] = [];
  for (const p of packs) {
    const resolved = await ensurePackCharacterIds(p);
    packIds.push(resolved);
    ids.push(...resolved);
  }
  const slots = await loadCharacterSlots(ids);
  const byId = new Map(slots.map((s) => [s.id, s]));
  return packs.map((p, i) => ({
    id: p.id,
    title: p.title,
    status: p.status,
    frameCount: p.frames.length,
    approvedCount: p.frames.filter((f) => f.status === "approved").length,
    coverStillUrl: p.coverStillUrl,
    updatedAt: p.updatedAt.toISOString(),
    characterSlots: (packIds[i] || [])
      .map((id) => byId.get(id))
      .filter(Boolean)
      .map((s) => s!),
  }));
}

export async function getOwnedPack(userId: string, packId: string) {
  return prisma.templatePack.findFirst({ where: { id: packId, userId } });
}

export async function createTemplatePack(
  userId: string,
  opts: { title: string; idea?: string; tags?: string[]; locationNote?: string },
) {
  const title = opts.title.trim() || "Новый шаблон";
  const pack = await prisma.templatePack.create({
    data: {
      userId,
      title,
      idea: opts.idea?.trim() || "",
      tagsJson: JSON.stringify(opts.tags || []),
      locationNote: opts.locationNote?.trim() || "",
    },
  });
  return toPublicPack(pack.id);
}

export async function updateTemplatePack(
  userId: string,
  packId: string,
  patch: {
    title?: string;
    idea?: string;
    tags?: string[];
    locationNote?: string;
    characterIds?: string[];
  },
) {
  const owned = await getOwnedPack(userId, packId);
  if (!owned) throw new Error("not found");

  if (owned.status === "published") {
    if (patch.characterIds !== undefined) {
      await persistPackCharacterIds(packId, patch.characterIds);
      return toPublicPack(packId);
    }
    throw new Error("Опубликованный шаблон нельзя редактировать");
  }

  await prisma.templatePack.update({
    where: { id: packId },
    data: {
      title: patch.title?.trim() || undefined,
      idea: patch.idea !== undefined ? patch.idea.trim() : undefined,
      locationNote: patch.locationNote !== undefined ? patch.locationNote.trim() : undefined,
      tagsJson: patch.tags ? JSON.stringify(patch.tags) : undefined,
      characterIdsJson: patch.characterIds ? JSON.stringify(patch.characterIds) : undefined,
    },
  });
  return toPublicPack(packId);
}

async function nextFrameIndex(packId: string) {
  const last = await prisma.templateFrame.findFirst({
    where: { packId },
    orderBy: { index: "desc" },
  });
  return (last?.index ?? -1) + 1;
}

function extractMetaPrompts(item: { prompt: string | null; metaJson: string }) {
  const meta = parseGalleryMeta(item.metaJson);
  const userNote = typeof meta.userNote === "string" ? meta.userNote : "";
  return {
    prompt: item.prompt?.trim() || "",
    userNote,
    poseId: typeof meta.poseId === "string" ? meta.poseId : null,
    durationSec: typeof meta.durationSec === "number" ? meta.durationSec : 5,
    stillId: typeof meta.stillId === "string" ? meta.stillId : null,
  };
}

/** Add gallery photo or video into an assembling template folder. */
export async function addGalleryToTemplate(
  userId: string,
  packId: string,
  opts: { itemId: string; frameId?: string; beat?: string; never?: string },
) {
  const pack = await getOwnedPack(userId, packId);
  if (!pack) throw new Error("not found");
  if (pack.status === "published") throw new Error("Папка уже опубликована");

  const item = await prisma.galleryItem.findFirst({
    where: { id: opts.itemId, userId },
  });
  if (!item) throw new Error("Элемент галереи не найден");
  if (item.kind !== "photo" && item.kind !== "video") {
    throw new Error("Можно добавить только фото или видео");
  }

  const meta = extractMetaPrompts(item);

  if (item.kind === "photo") {
    const idx = await nextFrameIndex(packId);
    const frame = await prisma.templateFrame.create({
      data: {
        packId,
        index: idx,
        title: item.title?.trim() || `Кадр ${idx + 1}`,
        beat: opts.beat?.trim() || meta.userNote || "",
        never: opts.never?.trim() || "",
        stillPrompt: meta.prompt,
        stillItemId: item.id,
        poseId: meta.poseId,
        status: "draft",
      },
    });
    await mergePackCharacterIds(packId, characterIdsFromGalleryItem(item));
    await prisma.templatePack.update({
      where: { id: packId },
      data: { coverStillUrl: item.resultUrl, updatedAt: new Date() },
    });
    return { frameId: frame.id, pack: await toPublicPack(packId) };
  }

  // video — attach to frame with matching still, explicit frame, or new partial frame
  let targetFrame = opts.frameId
    ? await prisma.templateFrame.findFirst({ where: { id: opts.frameId, packId } })
    : null;

  if (!targetFrame && meta.stillId) {
    targetFrame = await prisma.templateFrame.findFirst({
      where: { packId, stillItemId: meta.stillId },
    });
  }

  if (!targetFrame) {
    const idx = await nextFrameIndex(packId);
    targetFrame = await prisma.templateFrame.create({
      data: {
        packId,
        index: idx,
        title: item.title?.trim() || `Кадр ${idx + 1}`,
        beat: opts.beat?.trim() || "",
        videoPrompt: meta.prompt,
        clipItemId: item.id,
        durationSec: meta.durationSec,
        status: "draft",
      },
    });
  } else {
    await prisma.templateFrame.update({
      where: { id: targetFrame.id },
      data: {
        clipItemId: item.id,
        videoPrompt: meta.prompt || targetFrame.videoPrompt,
        durationSec: meta.durationSec || targetFrame.durationSec,
        status: targetFrame.status === "approved" ? "draft" : targetFrame.status,
      },
    });
  }

  await prisma.templatePack.update({ where: { id: packId }, data: { updatedAt: new Date() } });
  return { frameId: targetFrame.id, pack: await toPublicPack(packId) };
}

export async function updateTemplateFrame(
  userId: string,
  packId: string,
  frameId: string,
  patch: Partial<{
    title: string;
    beat: string;
    never: string;
    stillPrompt: string;
    videoPrompt: string;
    durationSec: number;
    dialogue: string;
    poseId: string | null;
    stillFailNote: string;
    videoFailNote: string;
    soloCharacterIndex: number | null;
    clothed: boolean;
  }>,
) {
  const pack = await getOwnedPack(userId, packId);
  if (!pack) throw new Error("not found");
  if (pack.status === "published") throw new Error("Опубликованный шаблон нельзя редактировать");

  const frame = await prisma.templateFrame.findFirst({ where: { id: frameId, packId } });
  if (!frame) throw new Error("Кадр не найден");

  await prisma.templateFrame.update({
    where: { id: frameId },
    data: {
      title: patch.title !== undefined ? patch.title.trim() : undefined,
      beat: patch.beat !== undefined ? patch.beat.trim() : undefined,
      never: patch.never !== undefined ? patch.never.trim() : undefined,
      stillPrompt: patch.stillPrompt !== undefined ? patch.stillPrompt.trim() : undefined,
      videoPrompt: patch.videoPrompt !== undefined ? patch.videoPrompt.trim() : undefined,
      dialogue: patch.dialogue !== undefined ? patch.dialogue.trim() : undefined,
      durationSec: patch.durationSec,
      poseId: patch.poseId,
      stillFailNote: patch.stillFailNote !== undefined ? patch.stillFailNote.trim() : undefined,
      videoFailNote: patch.videoFailNote !== undefined ? patch.videoFailNote.trim() : undefined,
      ...(patch.soloCharacterIndex !== undefined ? { soloCharacterIndex: patch.soloCharacterIndex } : {}),
      ...(patch.clothed !== undefined ? { clothed: patch.clothed } : {}),
      status: "draft",
    },
  });
  return toPublicPack(packId);
}

export async function approveTemplateFrame(userId: string, packId: string, frameId: string) {
  const pack = await getOwnedPack(userId, packId);
  if (!pack) throw new Error("not found");
  if (pack.status === "published") throw new Error("Уже опубликовано");

  const frame = await prisma.templateFrame.findFirst({ where: { id: frameId, packId } });
  if (!frame) throw new Error("Кадр не найден");
  if (!frame.stillItemId || !frame.clipItemId) {
    throw new Error("Нужны и фото, и видео для кадра");
  }

  const media = await mediaMap([frame.stillItemId, frame.clipItemId]);
  const still = media.get(frame.stillItemId);
  const clip = media.get(frame.clipItemId);
  if (!frameReady(still, clip)) {
    throw new Error("Медиа ещё генерируется или с ошибкой");
  }

  await prisma.templateFrame.update({
    where: { id: frameId },
    data: { status: "approved" },
  });

  if (frame.beat.trim() || frame.stillPrompt.trim()) {
    await logKbEntry({
      userId,
      templatePackId: packId,
      kind: "success",
      text: `Approved beat ${frame.index + 1}: ${frame.beat}\nStill: ${frame.stillPrompt}\nVideo: ${frame.videoPrompt}`,
      tags: parseJsonArray(pack.tagsJson),
      frameIndex: frame.index,
    });
  }

  return toPublicPack(packId);
}

export async function rejectTemplateFrame(
  userId: string,
  packId: string,
  frameId: string,
  note: { still?: string; video?: string },
) {
  const pack = await getOwnedPack(userId, packId);
  if (!pack) throw new Error("not found");

  const frame = await prisma.templateFrame.findFirst({ where: { id: frameId, packId } });
  if (!frame) throw new Error("Кадр не найден");

  const stillNote = note.still?.trim() || "";
  const videoNote = note.video?.trim() || "";

  await prisma.templateFrame.update({
    where: { id: frameId },
    data: {
      status: "draft",
      stillFailNote: stillNote || frame.stillFailNote,
      videoFailNote: videoNote || frame.videoFailNote,
    },
  });

  const fixText = [stillNote && `Still fix: ${stillNote}`, videoNote && `Video fix: ${videoNote}`]
    .filter(Boolean)
    .join("\n");
  if (fixText) {
    await logKbEntry({
      userId,
      templatePackId: packId,
      kind: "fix",
      text: `Beat ${frame.index + 1} rejected — ${fixText}`,
      tags: parseJsonArray(pack.tagsJson),
      frameIndex: frame.index,
    });
  }

  return toPublicPack(packId);
}

export async function deleteTemplateFrame(userId: string, packId: string, frameId: string) {
  const pack = await getOwnedPack(userId, packId);
  if (!pack) throw new Error("not found");
  if (pack.status === "published") throw new Error("Нельзя удалять кадры опубликованного шаблона");

  await prisma.templateFrame.deleteMany({ where: { id: frameId, packId } });
  const rest = await prisma.templateFrame.findMany({
    where: { packId },
    orderBy: { index: "asc" },
  });
  for (let i = 0; i < rest.length; i++) {
    if (rest[i].index !== i) {
      await prisma.templateFrame.update({ where: { id: rest[i].id }, data: { index: i } });
    }
  }
  return toPublicPack(packId);
}

export async function reorderTemplateFrames(userId: string, packId: string, frameIds: string[]) {
  const pack = await getOwnedPack(userId, packId);
  if (!pack) throw new Error("not found");
  if (pack.status === "published") throw new Error("Нельзя менять порядок опубликованного шаблона");

  const frames = await prisma.templateFrame.findMany({ where: { packId } });
  if (frameIds.length !== frames.length) throw new Error("Неверный список кадров");

  for (let i = 0; i < frameIds.length; i++) {
    await prisma.templateFrame.update({
      where: { id: frameIds[i] },
      data: { index: i },
    });
  }
  return toPublicPack(packId);
}

export async function animateTemplateFrame(
  userId: string,
  packId: string,
  frameId: string,
  opts?: {
    plot?: string;
    note?: string;
    composedPrompt?: string;
    durationSec?: number;
    withMusic?: boolean;
    dialogue?: string;
  },
) {
  const pack = await getOwnedPack(userId, packId);
  if (!pack) throw new Error("not found");
  if (pack.status === "published") throw new Error("Опубликованный шаблон нельзя менять");

  const frame = await prisma.templateFrame.findFirst({ where: { id: frameId, packId } });
  if (!frame) throw new Error("Кадр не найден");
  if (!frame.stillItemId) throw new Error("Сначала добавь фото в этот кадр");

  const still = await prisma.galleryItem.findFirst({
    where: { id: frame.stillItemId, userId, kind: "photo" },
  });
  if (!still) throw new Error("Фото кадра не найдено в галерее");
  const stillMeta = parseGalleryMeta(still.metaJson);
  if (stillMeta.status === "pending") throw new Error("Фото ещё генерируется");
  if (stillMeta.status === "error") throw new Error("Фото с ошибкой — перегенерируй кадр");

  const basePlot =
    opts?.plot?.trim() ||
    frame.beat.trim() ||
    still.title ||
    "match the still pose";
  const note = opts?.note?.trim() || frame.videoFailNote.trim();
  const dialogue = opts?.dialogue?.trim() ?? frame.dialogue;
  const plot = note ? `${basePlot}\nRevision note: ${note}` : basePlot;
  const durationSec = opts?.durationSec ?? frame.durationSec;
  const composedRaw = opts?.composedPrompt?.trim();
  const composed = composedRaw || (!note ? frame.videoPrompt.trim() : "") || undefined;

  await prisma.templateFrame.update({
    where: { id: frameId },
    data: {
      durationSec,
      videoPrompt: composed || frame.videoPrompt,
      videoFailNote: note || frame.videoFailNote,
      dialogue: dialogue ?? frame.dialogue,
      status: "draft",
    },
  });

  const item = await enqueueAnimateJob(
    userId,
    still.id,
    plot,
    !!opts?.withMusic,
    composed,
    durationSec,
    {
      templatePackId: packId,
      templateFrameId: frameId,
      poseId: frame.poseId,
      dialogue,
    },
  );

  await prisma.templateFrame.update({
    where: { id: frameId },
    data: { clipItemId: item.id },
  });

  return toPublicPack(packId);
}

export async function stitchTemplatePack(
  userId: string,
  packId: string,
  opts?: { withMusic?: boolean; musicNote?: string },
) {
  const pack = await getOwnedPack(userId, packId);
  if (!pack) throw new Error("not found");
  if (pack.status === "published") throw new Error("Опубликованный шаблон нельзя менять");

  const frames = await prisma.templateFrame.findMany({
    where: { packId },
    orderBy: { index: "asc" },
  });
  const clipIds = frames.map((f) => f.clipItemId).filter(Boolean) as string[];
  const clips = clipIds.length
    ? await prisma.galleryItem.findMany({ where: { id: { in: clipIds } } })
    : [];
  const byId = new Map(clips.map((c) => [c.id, c]));
  const urls: string[] = [];
  for (const f of frames) {
    if (!f.clipItemId) continue;
    const clip = byId.get(f.clipItemId);
    if (!clip) continue;
    const meta = parseGalleryMeta(clip.metaJson);
    if (meta.status === "pending") throw new Error("Дождись генерации всех роликов");
    if (meta.status === "error" || !clip.resultUrl) {
      throw new Error(`Ролик кадра #${f.index + 1} с ошибкой`);
    }
    urls.push(clip.resultUrl);
  }
  if (urls.length < 2) throw new Error("Нужно минимум два готовых ролика");

  await enqueueTemplateStitchJob(userId, packId, urls, {
    withMusic: opts?.withMusic,
    musicNote: opts?.musicNote,
  });
  return toPublicPack(packId);
}

function buildSearchText(pack: { title: string; idea: string; tagsJson: string }, frames: { beat: string; stillPrompt: string; videoPrompt: string }[]) {
  const tags = parseJsonArray(pack.tagsJson).join(" ");
  const beats = frames.map((f) => `${f.beat} ${f.stillPrompt} ${f.videoPrompt}`).join("\n");
  return `${pack.title} ${pack.idea} ${tags}\n${beats}`.slice(0, 12000);
}

export async function publishTemplatePack(userId: string, packId: string) {
  const pack = await getOwnedPack(userId, packId);
  if (!pack) throw new Error("not found");
  if (pack.status === "published") throw new Error("Уже опубликовано");

  const frames = await prisma.templateFrame.findMany({
    where: { packId },
    orderBy: { index: "asc" },
  });
  if (frames.length < 1) throw new Error("Добавь хотя бы один кадр");

  const notApproved = frames.filter((f) => f.status !== "approved");
  if (notApproved.length) {
    throw new Error(`Одобри все кадры (${notApproved.length} без галочки)`);
  }

  const searchText = buildSearchText(pack, frames);
  let coverStillUrl = pack.coverStillUrl;
  if (!coverStillUrl && frames[0].stillItemId) {
    const first = await prisma.galleryItem.findUnique({ where: { id: frames[0].stillItemId } });
    coverStillUrl = first?.resultUrl || null;
  }

  await prisma.templatePack.update({
    where: { id: packId },
    data: {
      status: "published",
      searchText,
      coverStillUrl,
      publishedAt: new Date(),
    },
  });

  await logPublishedTemplateKb(
    userId,
    packId,
    pack.title,
    frames.map((f) => ({
      index: f.index,
      beat: f.beat,
      stillPrompt: f.stillPrompt,
      videoPrompt: f.videoPrompt,
      never: f.never,
    })),
  );

  return toPublicPack(packId);
}

export async function deleteTemplatePack(userId: string, packId: string) {
  const pack = await getOwnedPack(userId, packId);
  if (!pack) throw new Error("not found");
  await prisma.templatePack.delete({ where: { id: packId } });
}

export type CoachReply = {
  reply: string;
  beat?: string;
  stillPrompt?: string;
  videoPrompt?: string;
  never?: string;
};

export async function coachTemplatePrompt(
  userId: string,
  packId: string,
  message: string,
  frameId?: string,
): Promise<CoachReply> {
  const pack = await getOwnedPack(userId, packId);
  if (!pack) throw new Error("not found");

  await ollamaPingWithRetry();

  const pub = await toPublicPack(packId);
  if (!pub) throw new Error("not found");

  const frame = frameId ? pub.frames.find((f) => f.id === frameId) : pub.frames[pub.frames.length - 1];
  const photoGuide = photoKnowledgeExcerpt().slice(0, 6000);
  const videoGuide = videoKnowledgeExcerpt().slice(0, 4000);

  const context = frame
    ? `Current beat #${frame.index + 1}:
Title: ${frame.title}
Story beat: ${frame.beat || "(empty)"}
Never: ${frame.never || "(none)"}
Still prompt: ${frame.stillPrompt || "(empty)"}
Video prompt: ${frame.videoPrompt || "(empty)"}
Duration: ${frame.durationSec}s`
    : "No frames yet — user is starting a new template.";

  const system = `You are Peach prompt coach for NSFW template building (Flux/Krea stills + MiniMax H3 I2V clips).
Template folder: «${pub.title}»
Idea: ${pub.idea || "(none)"}
Location: ${pub.locationNote || "(none)"}

${context}

PHOTO RULES:
${photoGuide}

VIDEO RULES:
${videoGuide}

Reply in Russian. Be concise and actionable.
If user asks to change prompts, output JSON block at the END:
\`\`\`json
{"beat":"...","never":"...","stillPrompt":"...","videoPrompt":"..."}
\`\`\`
Only include fields that should change. Prompts in English for the generators.`;

  const raw = await ollamaChat({
    messages: [
      { role: "system", content: system },
      { role: "user", content: message.trim() },
    ],
  });

  let reply = raw.trim();
  let beat: string | undefined;
  let stillPrompt: string | undefined;
  let videoPrompt: string | undefined;
  let never: string | undefined;

  const jsonMatch = reply.match(/```json\s*([\s\S]*?)```/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[1]) as Record<string, string>;
      beat = parsed.beat;
      stillPrompt = parsed.stillPrompt;
      videoPrompt = parsed.videoPrompt;
      never = parsed.never;
      reply = reply.replace(/```json[\s\S]*?```/, "").trim();
    } catch {
      /* ignore bad json */
    }
  }

  if (frameId && frame && (beat || stillPrompt || videoPrompt || never)) {
    await updateTemplateFrame(userId, packId, frameId, {
      beat: beat ?? frame.beat,
      stillPrompt: stillPrompt ?? frame.stillPrompt,
      videoPrompt: videoPrompt ?? frame.videoPrompt,
      never: never ?? frame.never,
    });
  }

  return { reply, beat, stillPrompt, videoPrompt, never };
}
