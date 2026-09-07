import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { mapGalleryItem, parseGalleryMeta } from "@/lib/gallery-meta";
import { prisma } from "@/lib/db";

export async function GET() {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });
  const items = await prisma.galleryItem.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    take: 150,
  });
  // Root gallery: folders + standalone items (not children of a film folder)
  const root = items.filter((i) => {
    const m = parseGalleryMeta(i.metaJson);
    if (i.kind === "film_folder" || m.isFolder) return true;
    if (typeof m.folderId === "string") return false;
    return true;
  });
  return NextResponse.json({
    items: root.slice(0, 100).map((i) => mapGalleryItem(i)),
  });
}

export async function DELETE(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id" }, { status: 400 });
  await prisma.galleryItem.deleteMany({ where: { id, userId: user.id } });
  return NextResponse.json({ ok: true });
}
