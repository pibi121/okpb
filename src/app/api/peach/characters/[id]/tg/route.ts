import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { saveGalleryBinary } from "@/lib/local-store";
import {
  publishCharacterToTg,
  unpublishCharacterFromTg,
} from "@/lib/tg/tg-publish";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

const bodySchema = z.object({
  displayName: z.string().max(80).optional(),
  coverUrl: z.string().max(500).optional(),
});

async function loadOwned(id: string, userId: string) {
  return prisma.character.findFirst({
    where: {
      id,
      OR: [{ userId }, { isStudioCast: true }],
    },
  });
}

/** Publish character into TG Mini App cast vitrine. */
export async function POST(req: NextRequest, ctx: Ctx) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });
  const { id } = await ctx.params;
  const ch = await loadOwned(id, user.id);
  if (!ch) return NextResponse.json({ error: "not found" }, { status: 404 });

  let displayName: string | undefined;
  let coverUrl: string | undefined;
  const contentType = req.headers.get("content-type") || "";
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
  } else if (contentType.includes("application/json")) {
    const body = bodySchema.parse(await req.json().catch(() => ({})));
    displayName = body.displayName;
    coverUrl = body.coverUrl;
  }

  try {
    const updated = await publishCharacterToTg(id, { displayName, coverUrl });
    return NextResponse.json({
      ok: true,
      published: true,
      character: {
        id: updated.id,
        name: updated.name,
        isStudioCast: updated.isStudioCast,
        tgDisplayName: updated.tgDisplayName,
        tgCoverUrl: updated.tgCoverUrl,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

/** Remove from TG cast vitrine. */
export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });
  const { id } = await ctx.params;
  const ch = await loadOwned(id, user.id);
  if (!ch) return NextResponse.json({ error: "not found" }, { status: 404 });

  try {
    const updated = await unpublishCharacterFromTg(id);
    return NextResponse.json({
      ok: true,
      published: false,
      character: {
        id: updated.id,
        name: updated.name,
        isStudioCast: updated.isStudioCast,
        tgDisplayName: updated.tgDisplayName,
        tgCoverUrl: updated.tgCoverUrl,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
