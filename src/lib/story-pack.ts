import { prisma } from "@/lib/db";
import { parseGalleryMeta } from "@/lib/gallery-meta";
import { ollamaChat, ollamaPingWithRetry, ollamaUnload } from "@/lib/ollama-client";
import { parseJsonArray } from "@/lib/film-project";
import { composePhotoPromptLLM, composeVideoPromptLLM } from "@/lib/prompt-composer-llm";
import { enqueueAnimateJob, enqueuePhotoJob } from "@/lib/gallery-jobs";
import type { PublicStoryBeat, PublicStoryPack } from "@/lib/story-pack-types";

export type { PublicStoryBeat, PublicStoryPack } from "@/lib/story-pack-types";
export { STORY_GENRES } from "@/lib/story-pack-types";

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

function syncBeatStatus(
  stored: string,
  job?: { status: string; error: string | null },
): string {
  if (!job) return stored;
  if (job.status === "pending") return "pending";
  if (job.status === "error") return "error";
  if (stored === "pending") return "ready";
  return stored;
}

export async function toPublicPack(packId: string): Promise<PublicStoryPack | null> {
  const pack = await prisma.storyPack.findUnique({
    where: { id: packId },
    include: { beats: { orderBy: { index: "asc" } } },
  });
  if (!pack) return null;
  const ids = pack.beats.flatMap((b) => [b.stillItemId, b.clipItemId]).filter(Boolean) as string[];
  const media = await mediaMap(ids);

  const beats: PublicStoryBeat[] = [];
  const statusPatch: { id: string; stillStatus?: string; videoStatus?: string }[] = [];

  for (const b of pack.beats) {
    const still = b.stillItemId ? media.get(b.stillItemId) : undefined;
    const clip = b.clipItemId ? media.get(b.clipItemId) : undefined;
    const stillStatus = syncBeatStatus(b.stillStatus, still);
    const videoStatus = syncBeatStatus(b.videoStatus, clip);
    if (stillStatus !== b.stillStatus || videoStatus !== b.videoStatus) {
      statusPatch.push({ id: b.id, stillStatus, videoStatus });
    }
    beats.push({
      id: b.id,
      index: b.index,
      title: b.title,
      beat: b.beat,
      never: b.never,
      isSex: b.isSex,
      poseId: b.poseId,
      stillPrompt: b.stillPrompt,
      videoPrompt: b.videoPrompt,
      stillItemId: b.stillItemId,
      clipItemId: b.clipItemId,
      stillStatus,
      videoStatus,
      stillFailNote: b.stillFailNote,
      videoFailNote: b.videoFailNote,
      stillUrl: still?.url || null,
      clipUrl: clip?.url || null,
      stillError: stillStatus === "error" ? still?.error || "ошибка кадра" : null,
      clipError: videoStatus === "error" ? clip?.error || "ошибка клипа" : null,
    });
  }

  await Promise.all(
    statusPatch.map((p) =>
      prisma.storyBeat.update({
        where: { id: p.id },
        data: {
          ...(p.stillStatus ? { stillStatus: p.stillStatus } : {}),
          ...(p.videoStatus ? { videoStatus: p.videoStatus } : {}),
        },
      }),
    ),
  );

  const approvedBeats = beats.filter(
    (b) => b.stillStatus === "approved" && (b.videoStatus === "approved" || b.videoStatus === "skipped"),
  ).length;
  const currentBeatIndex = beats.findIndex(
    (b) => !(b.stillStatus === "approved" && (b.videoStatus === "approved" || b.videoStatus === "skipped")),
  );
  const allDone = beats.length > 0 && approvedBeats === beats.length;
  const status = allDone ? "done" : beats.length ? "training" : "draft";
  if (status !== pack.status) {
    await prisma.storyPack.update({ where: { id: pack.id }, data: { status } });
  }

  return {
    id: pack.id,
    title: pack.title,
    idea: pack.idea,
    genre: pack.genre,
    characterIds: parseJsonArray(pack.characterIdsJson),
    locationNote: pack.locationNote,
    styleId: pack.styleId,
    status,
    error: pack.error,
    currentBeatIndex: currentBeatIndex < 0 ? Math.max(0, beats.length - 1) : currentBeatIndex,
    approvedBeats,
    beatCount: beats.length,
    beats,
    createdAt: pack.createdAt.toISOString(),
    updatedAt: pack.updatedAt.toISOString(),
  };
}

export async function listStoryPacks(userId: string) {
  const rows = await prisma.storyPack.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    include: { beats: { select: { stillStatus: true, videoStatus: true } } },
  });
  return Promise.all(rows.map((r) => toPublicPack(r.id))).then((xs) => xs.filter(Boolean) as PublicStoryPack[]);
}

export async function createStoryPack(
  userId: string,
  opts: {
    title: string;
    idea: string;
    genre?: string;
    characterIds?: string[];
    locationNote?: string;
    styleId?: string | null;
  },
) {
  const title = opts.title.trim() || opts.idea.trim().slice(0, 48) || "Сюжет";
  const row = await prisma.storyPack.create({
    data: {
      userId,
      title,
      idea: opts.idea.trim(),
      genre: opts.genre || "other",
      characterIdsJson: JSON.stringify(opts.characterIds || []),
      locationNote: opts.locationNote?.trim() || "",
      styleId: opts.styleId || null,
      status: "draft",
    },
  });
  return toPublicPack(row.id);
}

export async function getOwnedPack(userId: string, id: string) {
  return prisma.storyPack.findFirst({
    where: { id, userId },
    include: { beats: { orderBy: { index: "asc" } } },
  });
}

export async function updateStoryPack(
  userId: string,
  id: string,
  patch: {
    title?: string;
    idea?: string;
    genre?: string;
    characterIds?: string[];
    locationNote?: string;
    styleId?: string | null;
  },
) {
  const existing = await getOwnedPack(userId, id);
  if (!existing) throw new Error("not found");
  await prisma.storyPack.update({
    where: { id },
    data: {
      ...(patch.title != null ? { title: patch.title.trim() } : {}),
      ...(patch.idea != null ? { idea: patch.idea.trim() } : {}),
      ...(patch.genre != null ? { genre: patch.genre } : {}),
      ...(patch.characterIds ? { characterIdsJson: JSON.stringify(patch.characterIds) } : {}),
      ...(patch.locationNote != null ? { locationNote: patch.locationNote.trim() } : {}),
      ...(patch.styleId !== undefined ? { styleId: patch.styleId } : {}),
    },
  });
  return toPublicPack(id);
}

export async function deleteStoryPack(userId: string, id: string) {
  const existing = await getOwnedPack(userId, id);
  if (!existing) throw new Error("not found");
  await prisma.storyPack.delete({ where: { id } });
}

export async function addBeat(userId: string, packId: string) {
  const pack = await getOwnedPack(userId, packId);
  if (!pack) throw new Error("not found");
  const index = pack.beats.length;
  await prisma.storyBeat.create({
    data: {
      packId,
      index,
      title: `Кадр ${index + 1}`,
    },
  });
  await prisma.storyPack.update({ where: { id: packId }, data: { status: "training" } });
  return toPublicPack(packId);
}

export async function updateBeat(
  userId: string,
  packId: string,
  beatId: string,
  patch: Partial<{
    title: string;
    beat: string;
    never: string;
    isSex: boolean;
    poseId: string | null;
    stillPrompt: string;
    videoPrompt: string;
  }>,
) {
  const pack = await getOwnedPack(userId, packId);
  if (!pack) throw new Error("not found");
  const beat = pack.beats.find((b) => b.id === beatId);
  if (!beat) throw new Error("beat not found");
  await prisma.storyBeat.update({
    where: { id: beatId },
    data: {
      ...(patch.title != null ? { title: patch.title } : {}),
      ...(patch.beat != null ? { beat: patch.beat } : {}),
      ...(patch.never != null ? { never: patch.never } : {}),
      ...(patch.isSex != null ? { isSex: patch.isSex } : {}),
      ...(patch.poseId !== undefined ? { poseId: patch.poseId } : {}),
      ...(patch.stillPrompt != null ? { stillPrompt: patch.stillPrompt } : {}),
      ...(patch.videoPrompt != null ? { videoPrompt: patch.videoPrompt } : {}),
    },
  });
  return toPublicPack(packId);
}

export async function removeBeat(userId: string, packId: string, beatId: string) {
  const pack = await getOwnedPack(userId, packId);
  if (!pack) throw new Error("not found");
  await prisma.storyBeat.delete({ where: { id: beatId } });
  const rest = await prisma.storyBeat.findMany({
    where: { packId },
    orderBy: { index: "asc" },
  });
  await Promise.all(rest.map((b, i) => prisma.storyBeat.update({ where: { id: b.id }, data: { index: i } })));
  return toPublicPack(packId);
}

const SUGGEST_SYSTEM = `You split a user's story idea into 4-6 SINGLE still frames for an adult mini-film (18+ ok).
Output ONLY JSON: {"beats":[{"title":"short","beat":"what is IN this one frame (who, where, action, props)","never":"what must NOT be in this frame","isSex":false}]}
Rules:
- One action per frame. Chronological. Cover the idea, do not replace it with random sex.
- If the idea has running, a door, talk — those are their own frames.
- isSex=true only for an explicit sex frame.
- never: extra people, wrong location, wrong action.`;

export async function suggestBeats(userId: string, packId: string) {
  const pack = await getOwnedPack(userId, packId);
  if (!pack) throw new Error("not found");
  if (!(await ollamaPingWithRetry(40, 2000))) {
    throw new Error(
      "LLM недоступен: не поднялся туннель к Ollama. Запусти npm run tunnel:llm и подожди ~15 сек.",
    );
  }
  const raw = await ollamaChat({
    messages: [
      { role: "system", content: SUGGEST_SYSTEM },
      {
        role: "user",
        content: [
          `IDEA:\n${pack.idea}`,
          pack.locationNote ? `LOCATION HINT: ${pack.locationNote}` : "",
          pack.genre && pack.genre !== "other" ? `OPTIONAL TAG: ${pack.genre}` : "",
          "JSON only.",
        ]
          .filter(Boolean)
          .join("\n\n"),
      },
    ],
    numPredict: 900,
    temperature: 0.4,
    timeoutMs: 180_000,
  });
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("сценарист не вернул JSON");
  const data = JSON.parse(raw.slice(start, end + 1)) as {
    beats?: { title?: string; beat?: string; never?: string; isSex?: boolean }[];
  };
  const incoming = Array.isArray(data.beats) ? data.beats.slice(0, 8) : [];
  if (!incoming.length) throw new Error("пустая нарезка");

  await prisma.storyBeat.deleteMany({ where: { packId } });
  await prisma.storyBeat.createMany({
    data: incoming.map((b, i) => ({
      packId,
      index: i,
      title: String(b.title || `Кадр ${i + 1}`).trim(),
      beat: String(b.beat || "").trim(),
      never: String(b.never || "").trim(),
      isSex: !!b.isSex,
    })),
  });
  await prisma.storyPack.update({ where: { id: packId }, data: { status: "training", error: null } });
  return toPublicPack(packId);
}

export async function composeStillPrompt(userId: string, packId: string, beatId: string) {
  const pack = await getOwnedPack(userId, packId);
  if (!pack) throw new Error("not found");
  const beat = pack.beats.find((b) => b.id === beatId);
  if (!beat) throw new Error("beat not found");
  const characterIds = parseJsonArray(pack.characterIdsJson);
  const note = [
    beat.beat ? `This exact frame: ${beat.beat}` : "",
    pack.locationNote ? `Location: ${pack.locationNote}` : "",
    beat.never ? `Do not show: ${beat.never}` : "",
    "Keep identity from lookbook/LoRA. One frozen moment, not a sequence.",
  ]
    .filter(Boolean)
    .join(". ");
  const prompt = await composePhotoPromptLLM({
    characterIds,
    poseId: beat.poseId || undefined,
    styleId: pack.styleId || undefined,
    userNote: note,
    usePreset: !!beat.poseId || !!pack.styleId,
  });
  await ollamaUnload();
  await prisma.storyBeat.update({ where: { id: beatId }, data: { stillPrompt: prompt } });
  return toPublicPack(packId);
}

export async function composeVideoPrompt(userId: string, packId: string, beatId: string) {
  const pack = await getOwnedPack(userId, packId);
  if (!pack) throw new Error("not found");
  const beat = pack.beats.find((b) => b.id === beatId);
  if (!beat) throw new Error("beat not found");
  const prompt = await composeVideoPromptLLM({
    stillPrompt: beat.stillPrompt,
    userNote: [beat.beat, beat.never ? `Do not change to: ${beat.never}` : ""]
      .filter(Boolean)
      .join(". "),
    stillTitle: beat.title,
    poseId: beat.poseId,
    durationSec: 6,
  });
  await ollamaUnload();
  await prisma.storyBeat.update({ where: { id: beatId }, data: { videoPrompt: prompt } });
  return toPublicPack(packId);
}

export async function generateStill(userId: string, packId: string, beatId: string) {
  const pack = await getOwnedPack(userId, packId);
  if (!pack) throw new Error("not found");
  const beat = pack.beats.find((b) => b.id === beatId);
  if (!beat) throw new Error("beat not found");
  let stillPrompt = beat.stillPrompt.trim();
  if (!stillPrompt) {
    await composeStillPrompt(userId, packId, beatId);
    const again = await prisma.storyBeat.findUniqueOrThrow({ where: { id: beatId } });
    stillPrompt = again.stillPrompt.trim();
  }
  if (!stillPrompt) throw new Error("нет промпта кадра");
  const characterIds = parseJsonArray(pack.characterIdsJson);
  const item = await enqueuePhotoJob(userId, {
    userId,
    characterIds,
    characterId: characterIds[0] || null,
    title: `${pack.title} · ${beat.title || `кадр ${beat.index + 1}`}`,
    composedPrompt: stillPrompt,
    poseId: beat.poseId || undefined,
    styleId: pack.styleId || undefined,
    userNote: beat.beat,
    usePreset: false,
    width: 888,
    height: 1176,
    seed: Math.floor(Math.random() * 1e15),
  });
  await prisma.storyBeat.update({
    where: { id: beatId },
    data: {
      stillItemId: item.id,
      stillStatus: "pending",
      stillFailNote: "",
    },
  });
  return toPublicPack(packId);
}

export async function generateVideo(userId: string, packId: string, beatId: string) {
  const pack = await getOwnedPack(userId, packId);
  if (!pack) throw new Error("not found");
  const beat = pack.beats.find((b) => b.id === beatId);
  if (!beat) throw new Error("beat not found");
  if (!beat.stillItemId) throw new Error("сначала нужен кадр");
  let videoPrompt = beat.videoPrompt.trim();
  if (!videoPrompt) {
    await composeVideoPrompt(userId, packId, beatId);
    const again = await prisma.storyBeat.findUniqueOrThrow({ where: { id: beatId } });
    videoPrompt = again.videoPrompt.trim();
  }
  const item = await enqueueAnimateJob(
    userId,
    beat.stillItemId,
    beat.beat || "match the still",
    false,
    videoPrompt || undefined,
    6,
  );
  await prisma.storyBeat.update({
    where: { id: beatId },
    data: { clipItemId: item.id, videoStatus: "pending", videoFailNote: "" },
  });
  return toPublicPack(packId);
}

export async function rateStill(
  userId: string,
  packId: string,
  beatId: string,
  ok: boolean,
  note?: string,
) {
  const pack = await getOwnedPack(userId, packId);
  if (!pack) throw new Error("not found");
  await prisma.storyBeat.update({
    where: { id: beatId },
    data: ok
      ? { stillStatus: "approved", stillFailNote: "" }
      : { stillStatus: "rejected", stillFailNote: note?.trim() || "", videoStatus: "draft" },
  });
  return toPublicPack(packId);
}

export async function rateVideo(
  userId: string,
  packId: string,
  beatId: string,
  ok: boolean,
  note?: string,
  skip?: boolean,
) {
  const pack = await getOwnedPack(userId, packId);
  if (!pack) throw new Error("not found");
  await prisma.storyBeat.update({
    where: { id: beatId },
    data: skip
      ? { videoStatus: "skipped", videoFailNote: "" }
      : ok
        ? { videoStatus: "approved", videoFailNote: "" }
        : { videoStatus: "rejected", videoFailNote: note?.trim() || "" },
  });
  return toPublicPack(packId);
}

