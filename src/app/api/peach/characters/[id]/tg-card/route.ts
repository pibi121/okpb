import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { saveGalleryBinary } from "@/lib/local-store";
import { updateStudioCastTgCard } from "@/lib/tg/tg-publish";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

const jsonSchema = z.object({
  displayName: z.string().max(80).optional(),
  coverUrl: z.string().max(500).optional(),
});

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });
  const { id } = await ctx.params;

  const ch = await prisma.character.findFirst({
    where: { id, isStudioCast: true },
  });
  if (!ch) {
    return NextResponse.json({ error: "Актриса студии не найдена" }, { status: 404 });
  }

  const contentType = req.headers.get("content-type") || "";
  let displayName: string | undefined;
  let coverUrl: string | undefined;

  if (contentType.includes("multipart/form-data")) {
    const form = await req.formData();
    const dn = form.get("displayName");
    if (typeof dn === "string") displayName = dn;
    const coverFile = form.get("coverPhoto");
    if (coverFile instanceof File && coverFile.size > 0) {
      const bytes = Buffer.from(await coverFile.arrayBuffer());
      const ext = coverFile.name.split(".").pop()?.toLowerCase() || "jpg";
      const saved = saveGalleryBinary(user.id, ext, bytes, "tg_cast_cover");
      coverUrl = saved.publicUrl;
    }
  } else {
    const body = jsonSchema.parse(await req.json());
    displayName = body.displayName;
    coverUrl = body.coverUrl;
  }

  try {
    const updated = await updateStudioCastTgCard(id, { displayName, coverUrl });
    return NextResponse.json({
      ok: true,
      character: {
        id: updated.id,
        name: updated.name,
        tgDisplayName: updated.tgDisplayName,
        tgCoverUrl: updated.tgCoverUrl,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
