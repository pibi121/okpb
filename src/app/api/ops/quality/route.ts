import { prisma } from "@/lib/db";
import { withOps, jsonOk, jsonErr } from "@/lib/ops/http";
import { writeAudit } from "@/lib/ops/audit";
import { resolveQualityClaim } from "@/lib/tg/quality-claim";

export async function GET(req: Request) {
  return withOps("quality", async () => {
    const url = new URL(req.url);
    const status = (url.searchParams.get("status") || "").trim();
    const where =
      status === "pending" || status === "approved" || status === "rejected"
        ? { status }
        : {};

    const rows = await prisma.qualityClaim.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            balancePeaches: true,
            platformAccounts: {
              where: { platform: "telegram" },
              select: { platformUserId: true, username: true },
              take: 1,
            },
          },
        },
        galleryItem: {
          select: {
            id: true,
            kind: true,
            title: true,
            resultUrl: true,
            thumbUrl: true,
            createdAt: true,
          },
        },
      },
    });

    const userIds = [...new Set(rows.map((r) => r.userId))];
    const counts =
      userIds.length === 0
        ? []
        : await prisma.qualityClaim.groupBy({
            by: ["userId"],
            where: { userId: { in: userIds } },
            _count: { _all: true },
          });
    const countMap = new Map(counts.map((c) => [c.userId, c._count._all]));

    return jsonOk({
      rows: rows.map((r) => ({
        id: r.id,
        status: r.status,
        kind: r.kind,
        chargedPeaches: r.chargedPeaches,
        refundedPeaches: r.refundedPeaches,
        createdAt: r.createdAt.toISOString(),
        reviewedAt: r.reviewedAt?.toISOString() || null,
        userClaimsTotal: countMap.get(r.userId) || 1,
        user: {
          id: r.user.id,
          name: r.user.name,
          email: r.user.email,
          balancePeaches: r.user.balancePeaches,
          tgUsername: r.user.platformAccounts[0]?.username || null,
          tgId: r.user.platformAccounts[0]?.platformUserId || null,
        },
        item: {
          id: r.galleryItem.id,
          kind: r.galleryItem.kind,
          title: r.galleryItem.title,
          resultUrl: r.galleryItem.resultUrl,
          thumbUrl: r.galleryItem.thumbUrl,
          createdAt: r.galleryItem.createdAt.toISOString(),
        },
      })),
    });
  });
}

export async function POST(req: Request) {
  return withOps("quality", async (actor) => {
    const body = (await req.json().catch(() => ({}))) as {
      action?: string;
      claimId?: string;
    };
    if (
      !body.claimId ||
      (body.action !== "approve" && body.action !== "reject")
    ) {
      return jsonErr("claimId + action (approve|reject)");
    }

    const result = await resolveQualityClaim({
      claimId: body.claimId,
      action: body.action,
      actorId: actor.id,
    });
    if (!result.ok) return jsonErr(result.error);

    await writeAudit({
      actorId: actor.id,
      action: body.action === "approve" ? "qc_approve" : "qc_reject",
      targetType: "qualityClaim",
      targetId: body.claimId,
    });

    return jsonOk({ ok: true });
  });
}
