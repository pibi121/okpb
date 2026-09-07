import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { characterImagesDir } from "@/lib/character-dataset";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string; name: string }> };

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

export async function GET(_req: NextRequest, ctx: Ctx) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });
  const { id, name } = await ctx.params;
  const ch = await prisma.character.findFirst({ where: { id, userId: user.id } });
  if (!ch) return NextResponse.json({ error: "not found" }, { status: 404 });

  const safe = path.basename(decodeURIComponent(name));
  const abs = path.join(characterImagesDir(id), safe);
  if (!abs.startsWith(characterImagesDir(id)) || !fs.existsSync(abs)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const ext = path.extname(safe).toLowerCase();
  const bytes = fs.readFileSync(abs);
  return new NextResponse(bytes, {
    headers: {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Cache-Control": "private, max-age=3600",
    },
  });
}
