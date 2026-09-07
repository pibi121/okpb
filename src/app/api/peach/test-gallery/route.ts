import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import {
  getTestGalleryFolder,
  listTestGalleryFolders,
  rateTestGalleryShot,
  startLoraPoseTestFolder,
  summarizePoseRatings,
} from "@/lib/test-gallery";

export const runtime = "nodejs";
export const maxDuration = 900;

const startSchema = z.object({
  action: z.literal("start_lora_pose"),
  characterId: z.string().min(1),
  recreate: z.boolean().optional(),
});

const rateSchema = z.object({
  action: z.literal("rate"),
  shotId: z.string().min(1),
  rating: z.union([z.literal(-1), z.literal(0), z.literal(1), z.null()]),
});

export async function GET(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });

  const folderId = req.nextUrl.searchParams.get("folderId");
  if (folderId) {
    const folder = await getTestGalleryFolder(user.id, folderId);
    if (!folder) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({
      folder,
      poseSummary: summarizePoseRatings(folder.shots),
    });
  }

  const folders = await listTestGalleryFolders(user.id);
  return NextResponse.json({ folders });
}

export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });

  const body = await req.json();
  if (body?.action === "start_lora_pose") {
    const parsed = startSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.message }, { status: 400 });
    }
    try {
      const folder = await startLoraPoseTestFolder({
        userId: user.id,
        characterId: parsed.data.characterId,
        recreate: parsed.data.recreate,
      });
      return NextResponse.json({ folder });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "ошибка";
      return NextResponse.json({ error: msg }, { status: 400 });
    }
  }

  if (body?.action === "rate") {
    const parsed = rateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.message }, { status: 400 });
    }
    try {
      const shot = await rateTestGalleryShot(
        user.id,
        parsed.data.shotId,
        parsed.data.rating,
      );
      return NextResponse.json({ shot });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "ошибка";
      return NextResponse.json({ error: msg }, { status: 400 });
    }
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
