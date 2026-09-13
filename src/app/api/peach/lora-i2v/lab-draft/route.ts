import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import {
  loadLoraI2vLabDraft,
  recoverLoraI2vLabDraftFromGallery,
  saveLoraI2vLabDraft,
  type LoraI2vLabDraft,
} from "@/lib/lora-i2v-lab-draft";

export const runtime = "nodejs";

/** Load saved draft or rebuild from recent gallery still+animate pairs. */
export async function GET(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });

  const force = req.nextUrl.searchParams.get("recover") === "1";
  if (!force) {
    const saved = loadLoraI2vLabDraft(user.id);
    if (saved?.shots?.length) {
      return NextResponse.json({ draft: saved, recovered: false });
    }
  }

  const recovered = await recoverLoraI2vLabDraftFromGallery(user.id, {
    maxShots: 10,
    hours: 72,
  });
  if (!recovered) {
    return NextResponse.json(
      { error: "Не нашёл готовые still+видео за последние 72ч", draft: null },
      { status: 404 },
    );
  }
  return NextResponse.json({
    draft: recovered,
    recovered: true,
    shotCount: recovered.shots.length,
  });
}

/** Client autosave mirror on server (survives browser wipe). */
export async function PUT(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });
  try {
    const body = (await req.json()) as { draft?: LoraI2vLabDraft };
    if (!body.draft?.shots?.length) {
      return NextResponse.json({ error: "empty draft" }, { status: 400 });
    }
    const saved = saveLoraI2vLabDraft(user.id, {
      ...body.draft,
      source: "client",
    });
    return NextResponse.json({ ok: true, draft: saved });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
