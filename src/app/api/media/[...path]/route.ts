import fs from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { resolveGalleryFile } from "@/lib/local-store";
import { getSessionUserId } from "@/lib/auth";

export const runtime = "nodejs";

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
};

type Ctx = { params: Promise<{ path: string[] }> };

function parseRange(
  header: string | null,
  size: number,
): { start: number; end: number } | null {
  if (!header || !header.startsWith("bytes=") || size <= 0) return null;
  const spec = header.slice("bytes=".length).split(",")[0]?.trim() || "";
  const m = /^(\d*)-(\d*)$/.exec(spec);
  if (!m) return null;
  let start = m[1] ? Number(m[1]) : NaN;
  let end = m[2] ? Number(m[2]) : NaN;
  if (Number.isNaN(start) && Number.isNaN(end)) return null;
  if (Number.isNaN(start)) {
    // suffix: bytes=-N
    const suffix = end;
    if (!Number.isFinite(suffix) || suffix <= 0) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else if (Number.isNaN(end)) {
    end = size - 1;
  }
  if (start < 0 || start >= size || end < start) return null;
  end = Math.min(end, size - 1);
  return { start, end };
}

async function sessionIsOps(userId: string): Promise<boolean> {
  try {
    const { prisma } = await import("@/lib/db");
    const { isOpsRole } = await import("@/lib/ops/roles");
    const u = await prisma.user.findUnique({
      where: { id: userId },
      select: { adminRole: true },
    });
    return isOpsRole(u?.adminRole);
  } catch {
    return false;
  }
}

/** Stream gallery files with Range support (required for TG/WebKit video). */
export async function GET(req: NextRequest, ctx: Ctx) {
  const session = await getSessionUserId();

  const parts = (await ctx.params).path || [];
  const relKey = parts.join("/");

  // TG-catalog assets (preview thumbnails, cast covers) are public by design —
  // they are already served from /public/tg/catalog and are not user-specific.
  const isTgCatalog = relKey.startsWith("tg-catalog/");
  // Ops broadcast uploads must be fetchable by Telegram (no session cookie).
  const isOpsBroadcast =
    parts[0] === "_ops" && /^broadcast_/i.test(parts[1] || "");

  if (!isTgCatalog && !isOpsBroadcast) {
    // Private gallery: owner session, or ops staff (admin jobs / user pages).
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const ownerSegment = parts[0] ?? "";
    if (ownerSegment !== session && !(await sessionIsOps(session))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const abs = resolveGalleryFile(relKey);
  if (!abs) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const stat = fs.statSync(abs);
  const size = stat.size;
  const ext = path.extname(abs).toLowerCase();
  const contentType = MIME[ext] || "application/octet-stream";
  // TG-catalog assets are public thumbnails; user gallery is private — never cache
  // in shared/CDN stores. "immutable" is dropped to prevent stale cached versions
  // from leaking between sessions.
  const cache =
    isTgCatalog || isOpsBroadcast
      ? "public, max-age=31536000, immutable"
      : "private, max-age=3600";

  const range = parseRange(req.headers.get("range"), size);
  if (range) {
    const { start, end } = range;
    const chunkSize = end - start + 1;
    const fd = fs.openSync(abs, "r");
    try {
      const buf = Buffer.alloc(chunkSize);
      fs.readSync(fd, buf, 0, chunkSize, start);
      return new NextResponse(buf, {
        status: 206,
        headers: {
          "Content-Type": contentType,
          "Content-Length": String(chunkSize),
          "Content-Range": `bytes ${start}-${end}/${size}`,
          "Accept-Ranges": "bytes",
          "Cache-Control": cache,
        },
      });
    } finally {
      fs.closeSync(fd);
    }
  }

  const buf = fs.readFileSync(abs);
  return new NextResponse(buf, {
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(size),
      "Accept-Ranges": "bytes",
      "Cache-Control": cache,
    },
  });
}
