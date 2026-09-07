import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { requireUser } from "@/lib/auth";

const CLIPS_PATH = path.join(process.cwd(), "data", "eros-eval-clips.json");
const RATINGS_PATH = path.join(process.cwd(), "data", "eros-eval-ratings.json");

export type Score = "bad" | "mid" | "good";

export type ClipRating = {
  identity: Score | null;
  action: Score | null;
  audio: Score | null;
  picture: Score | null;
  genitals: Score | null;
  note?: string;
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
  const clipsDoc = readJson<{ clips?: unknown[] }>(CLIPS_PATH, { clips: [] });
  const ratingsDoc = readJson<{ ratings?: Record<string, ClipRating> }>(
    RATINGS_PATH,
    { ratings: {} },
  );
  return NextResponse.json({
    clips: clipsDoc.clips || [],
    ratings: ratingsDoc.ratings || {},
  });
}

export async function POST(req: Request) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });
  const body = (await req.json()) as {
    clipId?: string;
    rating?: ClipRating;
  };
  if (!body.clipId || !body.rating) {
    return NextResponse.json({ error: "clipId+rating required" }, { status: 400 });
  }
  const ratingsDoc = readJson<{
    updatedAt?: string;
    ratings?: Record<string, ClipRating>;
  }>(RATINGS_PATH, { ratings: {} });
  const ratings = { ...(ratingsDoc.ratings || {}) };
  ratings[body.clipId] = body.rating;
  const out = {
    updatedAt: new Date().toISOString(),
    ratings,
  };
  fs.mkdirSync(path.dirname(RATINGS_PATH), { recursive: true });
  fs.writeFileSync(RATINGS_PATH, JSON.stringify(out, null, 2), "utf8");
  return NextResponse.json({ ok: true, ratings });
}
