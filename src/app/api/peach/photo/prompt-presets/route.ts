import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { loadPhotoEditPromptPresets } from "@/lib/photo-edit-prompt-presets";

export const runtime = "nodejs";

export async function GET() {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });
  return NextResponse.json({ presets: loadPhotoEditPromptPresets() });
}
