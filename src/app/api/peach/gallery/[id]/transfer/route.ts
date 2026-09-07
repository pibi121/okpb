import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { transferGalleryItem } from "@/lib/gallery-tg-transfer";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

const bodySchema = z.object({
  mode: z.enum(["both", "tg"]),
  title: z.string().max(120).optional(),
  displayTitle: z.string().max(120).optional(),
});

export async function POST(req: NextRequest, ctx: Ctx) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });
  const { id } = await ctx.params;

  try {
    const body = bodySchema.parse(await req.json());
    const result = await transferGalleryItem({
      userId: user.id,
      galleryItemId: id,
      mode: body.mode,
      title: body.title,
      displayTitle: body.displayTitle,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
