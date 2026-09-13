/**
 * Persist / recover LoRA→I2V lab multi-shot drafts from gallery history.
 */
import fs from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/db";
import { dataRoot, ensureDataDirs } from "@/lib/paths";
import { GALLERY_PLACEHOLDER_URL, galleryStatus } from "@/lib/gallery-meta";
import {
  emptyLoraI2vShot,
  newLoraI2vShotId,
  type LoraI2vShotSpec,
} from "@/lib/lora-i2v-shots";

export type LoraI2vLabShotDraft = LoraI2vShotSpec & {
  stillItemId: string;
  stillUrl: string;
  videoItemId: string;
  videoUrl: string;
};

export type LoraI2vLabDraft = {
  characterId: string;
  title: string;
  notes: string;
  orientation: "9_16" | "16_9" | "1_1";
  categories: string[];
  editingId: string;
  shots: LoraI2vLabShotDraft[];
  stitchedVideoItemId: string;
  stitchedVideoUrl: string;
  stitchedDurationSec: number;
  savedAt: number;
  source: "gallery_recover" | "client" | "manual";
};

function draftPath(userId: string) {
  ensureDataDirs();
  const dir = path.join(dataRoot(), "li2v-lab-drafts");
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${userId}.json`);
}

export function saveLoraI2vLabDraft(userId: string, draft: LoraI2vLabDraft) {
  const payload: LoraI2vLabDraft = {
    ...draft,
    savedAt: Date.now(),
  };
  fs.writeFileSync(draftPath(userId), JSON.stringify(payload, null, 2), "utf8");
  return payload;
}

export function loadLoraI2vLabDraft(userId: string): LoraI2vLabDraft | null {
  try {
    const p = draftPath(userId);
    if (!fs.existsSync(p)) return null;
    const raw = JSON.parse(fs.readFileSync(p, "utf8")) as LoraI2vLabDraft;
    if (!Array.isArray(raw.shots) || !raw.shots.length) return null;
    return raw;
  } catch {
    return null;
  }
}

function parseMeta(raw: string | null): Record<string, unknown> {
  try {
    return JSON.parse(raw || "{}") as Record<string, unknown>;
  } catch {
    return {};
  }
}

function usableUrl(url: string | null | undefined) {
  const u = (url || "").trim();
  return u && u !== GALLERY_PLACEHOLDER_URL && !/placeholder/i.test(u) ? u : "";
}

/**
 * Rebuild lab draft from recent Animate clips that point at stills.
 * Takes the latest cluster (up to N shots), oldest→newest for shot order.
 */
export async function recoverLoraI2vLabDraftFromGallery(
  userId: string,
  opts?: { maxShots?: number; hours?: number },
): Promise<LoraI2vLabDraft | null> {
  const maxShots = Math.max(2, Math.min(20, opts?.maxShots ?? 8));
  const hours = Math.max(6, Math.min(168, opts?.hours ?? 72));
  const since = new Date(Date.now() - hours * 3600 * 1000);

  const videos = await prisma.galleryItem.findMany({
    where: {
      userId,
      kind: "video",
      createdAt: { gte: since },
    },
    orderBy: { createdAt: "desc" },
    take: 40,
  });

  type Pair = {
    videoId: string;
    videoUrl: string;
    videoPrompt: string;
    durationSec: number;
    stillId: string;
    stillUrl: string;
    stillPrompt: string;
    characterId: string;
    createdAt: number;
    title: string;
  };

  const pairs: Pair[] = [];
  for (const v of videos) {
    if (galleryStatus(v.metaJson) !== "ready") continue;
    const videoUrl = usableUrl(v.resultUrl);
    if (!videoUrl) continue;
    const meta = parseMeta(v.metaJson);
    const stillId = String(meta.stillId || "").trim();
    if (!stillId) continue;
    // Prefer lab animate / clip jobs; skip unrelated films if no still link (already required).
    const still = await prisma.galleryItem.findFirst({
      where: { id: stillId, userId, kind: "photo" },
    });
    if (!still) continue;
    const stillUrl = usableUrl(still.resultUrl);
    if (!stillUrl) continue;
    if (galleryStatus(still.metaJson) === "error") continue;

    pairs.push({
      videoId: v.id,
      videoUrl,
      videoPrompt: (v.prompt || "").trim(),
      durationSec: Math.min(12, Math.max(4, Number(meta.durationSec) || 6)),
      stillId: still.id,
      stillUrl,
      stillPrompt: (still.prompt || "").trim(),
      characterId: still.characterId || v.characterId || "",
      createdAt: v.createdAt.getTime(),
      title: still.title || v.title || "",
    });
  }

  // Fallback: Animate: <still title> without stillId in meta
  if (pairs.length < 2) {
    const stills = await prisma.galleryItem.findMany({
      where: {
        userId,
        kind: "photo",
        createdAt: { gte: since },
        title: { contains: "LoRA" },
      },
      orderBy: { createdAt: "desc" },
      take: 30,
    });
    for (const v of videos) {
      if (pairs.some((p) => p.videoId === v.id)) continue;
      if (galleryStatus(v.metaJson) !== "ready") continue;
      const videoUrl = usableUrl(v.resultUrl);
      if (!videoUrl) continue;
      const title = v.title || "";
      const m = /^Animate:\s*(.+)$/i.exec(title);
      if (!m) continue;
      const stillTitle = m[1]!.trim();
      const still =
        stills.find((s) => (s.title || "").trim() === stillTitle) ||
        stills.find((s) => (s.title || "").includes(stillTitle.slice(0, 24)));
      if (!still) continue;
      const stillUrl = usableUrl(still.resultUrl);
      if (!stillUrl) continue;
      const meta = parseMeta(v.metaJson);
      pairs.push({
        videoId: v.id,
        videoUrl,
        videoPrompt: (v.prompt || "").trim(),
        durationSec: Math.min(12, Math.max(4, Number(meta.durationSec) || 6)),
        stillId: still.id,
        stillUrl,
        stillPrompt: (still.prompt || "").trim(),
        characterId: still.characterId || v.characterId || "",
        createdAt: v.createdAt.getTime(),
        title: still.title || v.title || "",
      });
    }
  }

  // Prefer stills from LoRA→I2V lab titles when present.
  const labish = pairs.filter((p) =>
    /lora\s*→\s*i2v|lora.?i2v|animate:/i.test(p.title),
  );
  const pool = labish.length >= 2 ? labish : pairs;

  // Newest cluster: walk from newest, keep while within 8h of newest.
  const newest = pool[0]!.createdAt;
  const cluster = pool
    .filter((p) => newest - p.createdAt <= 8 * 3600 * 1000)
    .slice(0, maxShots)
    .sort((a, b) => a.createdAt - b.createdAt);

  if (!cluster.length) return null;

  const characterId = cluster.find((c) => c.characterId)?.characterId || "";
  const shots: LoraI2vLabShotDraft[] = cluster.map((p, i) => {
    const base = emptyLoraI2vShot({
      id: newLoraI2vShotId(),
      stillPrompt: p.stillPrompt || `shot ${i + 1} still`,
      i2vPrompt: p.videoPrompt || `shot ${i + 1} motion`,
      durationSec: p.durationSec,
    });
    return {
      ...base,
      stillItemId: p.stillId,
      stillUrl: p.stillUrl,
      videoItemId: p.videoId,
      videoUrl: p.videoUrl,
    };
  });

  const draft: LoraI2vLabDraft = {
    characterId,
    title: "",
    notes: `recover ${new Date().toISOString()} · ${shots.length} shots`,
    orientation: "9_16",
    categories: [],
    editingId: "",
    shots,
    stitchedVideoItemId: "",
    stitchedVideoUrl: "",
    stitchedDurationSec: 0,
    savedAt: Date.now(),
    source: "gallery_recover",
  };

  return saveLoraI2vLabDraft(userId, draft);
}
