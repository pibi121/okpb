import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { enqueuePhotoEditLabJob } from "@/lib/photo-edit-lab";
import { listKreaConceptLorasForLab } from "@/lib/krea-concept-loras";

export const runtime = "nodejs";
export const maxDuration = 900;

export async function GET() {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });
  return NextResponse.json({
    conceptLoras: listKreaConceptLorasForLab(),
    undressStack: [
      { id: "projector", label: "Projector @0.01", fixed: true },
      { id: "realism", label: "Realism Engine v3.1 @0.7", fixed: true },
    ],
  });
}

export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });

  const form = await req.formData();
  const photo = form.get("photo");
  const editPrompt = String(form.get("editPrompt") || "").trim();
  const title = String(form.get("title") || "").trim();
  const useUndressStack = String(form.get("useUndressStack") || "1") !== "0";

  let conceptLoraIds: string[] = [];
  try {
    const raw = form.get("conceptLoraIds");
    if (typeof raw === "string" && raw.trim()) {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        conceptLoraIds = parsed.filter((x): x is string => typeof x === "string");
      }
    }
  } catch {
    /* ignore */
  }

  if (!(photo instanceof File) || photo.size <= 0) {
    return NextResponse.json({ error: "Загрузи фото" }, { status: 400 });
  }
  if (editPrompt.length < 2) {
    return NextResponse.json({ error: "Нужен промпт" }, { status: 400 });
  }

  const bytes = Buffer.from(await photo.arrayBuffer());
  const { galleryItemId } = await enqueuePhotoEditLabJob({
    userId: user.id,
    photoBytes: bytes,
    editPrompt,
    conceptLoraIds,
    useUndressStack,
    title: title || "Photo edit",
  });

  return NextResponse.json({ galleryItemId, ok: true });
}
