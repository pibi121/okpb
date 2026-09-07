import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { mapGalleryItem, parseGalleryMeta } from "@/lib/gallery-meta";
import { prisma } from "@/lib/db";

export async function GET(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });

  const kind = req.nextUrl.searchParams.get("kind") || "photo";
  const kinds = kind === "video" ? ["video"] : ["photo"];

  const items = await prisma.galleryItem.findMany({
    where: { userId: user.id, kind: { in: kinds } },
    orderBy: { createdAt: "desc" },
    take: 80,
  });

  const runs =
    kind === "video"
      ? await prisma.quickVideoRun.findMany({
          where: { userId: user.id },
          orderBy: { createdAt: "desc" },
          take: 20,
          select: {
            id: true,
            title: true,
            status: true,
            prompt: true,
            resultVideoUrl: true,
            createdAt: true,
            galleryItemId: true,
          },
        })
      : [];

  const galleryIds = new Set(items.map((i) => i.id));
  const linkedRunIds = new Set(
    items
      .map((i) => parseGalleryMeta(i.metaJson).quickVideoRunId)
      .filter((id): id is string => typeof id === "string"),
  );

  const { isStoryH3RunPrompt } = await import("@/lib/story-h3-prompt");

  const fromRuns = runs
    .filter((r) => {
      if (linkedRunIds.has(r.id)) return false;
      if (r.status === "busy") return true;
      if (r.galleryItemId) return !galleryIds.has(r.galleryItemId);
      return !!r.resultVideoUrl;
    })
    .map((r) => {
      const storyH3 = isStoryH3RunPrompt(r.prompt);
      return {
        id: r.galleryItemId || r.id,
        kind: "video" as const,
        title: r.title,
        prompt: r.prompt,
        resultUrl: r.resultVideoUrl || "",
        status:
          r.status === "busy"
            ? "pending"
            : r.status === "ready"
              ? "ready"
              : r.status,
        createdAt: r.createdAt.toISOString(),
        meta: {
          quickVideoRunId: r.id,
          storyH3,
          jobAction: storyH3 ? "story_h3_video" : "quick_video",
          shotsJson: r.prompt,
        },
      };
    });

  const mapped = items.map((i) => {
    const m = mapGalleryItem(i);
    const meta = parseGalleryMeta(i.metaJson);
    const storyH3 =
      meta.storyH3 === true ||
      meta.jobAction === "story_h3_video" ||
      (typeof meta.shotsJson === "string" && isStoryH3RunPrompt(meta.shotsJson)) ||
      isStoryH3RunPrompt(i.prompt || "");
    return {
      id: m.id,
      kind: m.kind,
      title: m.title,
      prompt: i.prompt,
      resultUrl: m.resultUrl,
      status: m.status,
      createdAt: m.createdAt,
      width: i.width,
      height: i.height,
      meta: storyH3
        ? { ...meta, storyH3: true, jobAction: "story_h3_video" }
        : meta,
    };
  });

  return NextResponse.json({ items: [...mapped, ...fromRuns] });
}
