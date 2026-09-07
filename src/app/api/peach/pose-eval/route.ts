import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { requireUser } from "@/lib/auth";

const RATINGS_PATH = path.join(process.cwd(), "data", "pose-eval-ratings.json");

const BATCH_FILES = [
  {
    id: "1",
    label: "Batch 1 · 11 базовых поз",
    prompts: path.join(process.cwd(), "data", "pose-eval-prompts.json"),
    clips: path.join(process.cwd(), "data", "pose-eval-clips.json"),
    itemsKey: "poses" as const,
  },
  {
    id: "2",
    label: "Batch 2 · 64 недостающих поз",
    prompts: path.join(process.cwd(), "data", "pose-eval-prompts-batch2.json"),
    clips: path.join(process.cwd(), "data", "pose-eval-clips-batch2.json"),
    itemsKey: "poses" as const,
  },
  {
    id: "3",
    label: "Batch 3 · Picture4 penis ref test (3 позы)",
    prompts: path.join(
      process.cwd(),
      "data",
      "pose-eval-prompts-batch3-picture4-test.json",
    ),
    clips: path.join(process.cwd(), "data", "pose-eval-clips-batch3.json"),
    itemsKey: "poses" as const,
  },
  {
    id: "4",
    label: "Batch 4 · corrected poses (40)",
    prompts: path.join(process.cwd(), "data", "pose-eval-prompts-batch4.json"),
    clips: path.join(process.cwd(), "data", "pose-eval-clips-batch4.json"),
    itemsKey: "poses" as const,
  },
  {
    id: "5",
    label: "Batch 5 · утверждённый каталог (37)",
    prompts: path.join(process.cwd(), "data", "pose-eval-prompts-batch5.json"),
    clips: path.join(process.cwd(), "data", "pose-eval-clips-batch5.json"),
    itemsKey: "poses" as const,
  },
  {
    id: "actions",
    label: "Actions · 61 действие",
    prompts: path.join(process.cwd(), "data", "action-eval-prompts-batch1.json"),
    clips: path.join(process.cwd(), "data", "action-eval-clips-batch1.json"),
    itemsKey: "items" as const,
  },
  {
    id: "combo",
    label: "Combo · camera + voice (70)",
    prompts: path.join(process.cwd(), "data", "combo-eval-prompts-v1.json"),
    clips: path.join(process.cwd(), "data", "combo-eval-clips-v1.json"),
    itemsKey: "items" as const,
  },
];

export type Score = "bad" | "mid" | "good";

export type PoseClipRating = {
  identity: Score | null;
  picture: Score | null;
  poseFit?: Score | null;
  actionFit?: Score | null;
  baseFit?: Score | null;
  addonFit?: Score | null;
  categoryFits?: Record<string, Score | null>;
  note?: string;
};

export type PoseGroupRating = {
  pickBest: "1" | "2" | null;
  promote?: boolean;
};

function readJson<T>(file: string, fallback: T): T {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

export async function GET() {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });

  const batches = BATCH_FILES.map((b) => {
    const clipsDoc = readJson<Record<string, unknown>>(b.clips, { clips: [] });
    const promptsDoc = readJson<Record<string, unknown>>(b.prompts, {});
    const rawItems =
      (promptsDoc[b.itemsKey] as unknown[]) ||
      (promptsDoc.poses as unknown[]) ||
      [];
    const items = rawItems.map((p) => {
      const row = p as Record<string, unknown>;
      return {
        id: String(row.id || ""),
        title: String(row.title || ""),
        brick: String(row.brick || ""),
        evalHintRu: row.evalHintRu ? String(row.evalHintRu) : undefined,
        bricks: row.bricks,
        ratingCategories: row.ratingCategories,
        evalType: row.evalType ? String(row.evalType) : undefined,
      };
    });
    const clips = ((clipsDoc.clips as unknown[]) || []).map((c) => ({
      ...(c as object),
      batchId: b.id,
    }));
    return {
      id: b.id,
      label: b.label,
      evalType:
        (clipsDoc.evalType as string | undefined) ||
        (promptsDoc.evalType as string | undefined) ||
        b.itemsKey,
      meta: {
        status: clipsDoc.status,
        startedAt: clipsDoc.startedAt,
        finishedAt: clipsDoc.finishedAt,
        totalExpected: clipsDoc.totalExpected,
      },
      clips,
      poses: items,
    };
  });

  const ratingsDoc = readJson<{
    clips?: Record<string, PoseClipRating>;
    groups?: Record<string, PoseGroupRating>;
  }>(RATINGS_PATH, { clips: {}, groups: {} });

  return NextResponse.json({
    batches,
    ratings: ratingsDoc.clips || {},
    groupRatings: ratingsDoc.groups || {},
  });
}

export async function POST(req: Request) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });

  const body = (await req.json()) as {
    clipId?: string;
    poseId?: string;
    clipRating?: PoseClipRating;
    groupRating?: PoseGroupRating;
  };

  const ratingsDoc = readJson<{
    updatedAt?: string;
    clips?: Record<string, PoseClipRating>;
    groups?: Record<string, PoseGroupRating>;
  }>(RATINGS_PATH, { clips: {}, groups: {} });

  const clips = { ...(ratingsDoc.clips || {}) };
  const groups = { ...(ratingsDoc.groups || {}) };

  if (body.clipId && body.clipRating) {
    clips[body.clipId] = body.clipRating;
  }
  if (body.poseId && body.groupRating) {
    groups[body.poseId] = body.groupRating;
  }

  if (!body.clipId && !body.poseId) {
    return NextResponse.json({ error: "clipId or poseId required" }, { status: 400 });
  }

  const out = {
    updatedAt: new Date().toISOString(),
    clips,
    groups,
  };
  fs.mkdirSync(path.dirname(RATINGS_PATH), { recursive: true });
  fs.writeFileSync(RATINGS_PATH, JSON.stringify(out, null, 2), "utf8");

  return NextResponse.json({ ok: true, ratings: clips, groupRatings: groups });
}
