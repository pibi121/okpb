import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { mapGalleryItem } from "@/lib/gallery-meta";
import { prisma } from "@/lib/db";
import { maintenanceApiBlock } from "@/lib/ops/maintenance-api";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const maintenanceBlock = await maintenanceApiBlock();
  if (maintenanceBlock) return maintenanceBlock;

  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });
  const { id } = await ctx.params;
  const item = await prisma.galleryItem.findFirst({
    where: { id, userId: user.id },
  });
  if (!item) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ item: mapGalleryItem(item) });
}
