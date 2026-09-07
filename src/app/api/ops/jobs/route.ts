import { prisma } from "@/lib/db";
import { jsonOk, jsonErr, withOps } from "@/lib/ops/http";
import { galleryStatus, parseGalleryMeta } from "@/lib/gallery-meta";
import { enqueueQuickVideoJob } from "@/lib/quick-video";
import { writeAudit } from "@/lib/ops/audit";
import { creditPeaches } from "@/lib/tg/wallet";

export async function GET(req: Request) {
  return withOps("jobs", async () => {
    const url = new URL(req.url);
    const q = (url.searchParams.get("q") || "").trim();
    const status = url.searchParams.get("status") || "";
    const kind = url.searchParams.get("kind") || "";
    const take = 40;
    const where: Record<string, unknown> = {};
    if (kind) where.kind = kind;
    if (q) {
      where.OR = [
        { title: { contains: q } },
        { user: { name: { contains: q } } },
        { user: { email: { contains: q } } },
      ];
    }
    if (status === "pending") where.metaJson = { contains: "\"status\":\"pending\"" };
    if (status === "error") where.metaJson = { contains: "\"status\":\"error\"" };
    if (status === "ready") where.metaJson = { contains: "\"status\":\"ready\"" };

    const rows = await prisma.galleryItem.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take,
      include: {
        user: { select: { id: true, name: true, email: true } },
        character: { select: { id: true, name: true, loraStatus: true } },
      },
    });
    return jsonOk({
      rows: rows.map((g) => ({
        id: g.id,
        kind: g.kind,
        title: g.title,
        resultUrl: g.resultUrl,
        status: galleryStatus(g.metaJson),
        error: parseGalleryMeta(g.metaJson).error || null,
        createdAt: g.createdAt.toISOString(),
        user: g.user,
        character: g.character,
        runId: parseGalleryMeta(g.metaJson).quickVideoRunId || null,
      })),
    });
  });
}

export async function POST(req: Request) {
  return withOps("jobs", async (actor) => {
    const body = (await req.json()) as {
      action?: string;
      runId?: string;
      itemId?: string;
      userId?: string;
      amount?: number;
    };
    if (body.action === "retry" && body.runId && body.userId) {
      await prisma.quickVideoRun.update({
        where: { id: body.runId },
        data: { status: "busy", error: null },
      });
      enqueueQuickVideoJob(body.runId, body.userId);
      await writeAudit({
        actorId: actor.id,
        action: "retry_video",
        targetType: "quickVideoRun",
        targetId: body.runId,
      });
      return jsonOk({ ok: true });
    }
    if (body.action === "refund" && body.userId) {
      const amount = Math.floor(Number(body.amount) || 0);
      if (amount <= 0) return jsonErr("Сумма?");
      await creditPeaches(body.userId, amount, "admin_refund", {
        actorId: actor.id,
        itemId: body.itemId || "",
      });
      await writeAudit({
        actorId: actor.id,
        action: "refund",
        targetType: "user",
        targetId: body.userId,
        detail: { amount, itemId: body.itemId },
      });
      return jsonOk({ ok: true });
    }
    return jsonErr("Неизвестное действие");
  });
}
