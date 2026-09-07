import { prisma } from "@/lib/db";
import { jsonOk, jsonErr, withOps } from "@/lib/ops/http";
import { listPendingPartnerWithdrawals } from "@/lib/tg/partner-admin";
import { writeAudit } from "@/lib/ops/audit";

export async function GET() {
  return withOps("partners", async () => {
    const [partners, pending] = await Promise.all([
      prisma.partnerProfile.findMany({
        orderBy: { totalEarnedPeaches: "desc" },
        take: 50,
        include: {
          user: { select: { name: true, email: true } },
          links: true,
        },
      }),
      listPendingPartnerWithdrawals(),
    ]);
    return jsonOk({
      partners: partners.map((p) => ({
        ...p,
        createdAt: p.createdAt.toISOString(),
      })),
      pending: pending.map((w) => ({
        ...w,
        createdAt: w.createdAt.toISOString(),
      })),
    });
  });
}

export async function POST(req: Request) {
  return withOps("partners", async (actor) => {
    const body = (await req.json()) as {
      action?: string;
      id?: string;
      note?: string;
    };
    if (!body.id || !body.action) return jsonErr("Нужны id и действие");
    if (body.action !== "approve" && body.action !== "reject") {
      return jsonErr("approve или reject");
    }
    const status = body.action === "approve" ? "paid" : "rejected";
    const w = await prisma.partnerWithdrawal.findUnique({ where: { id: body.id } });
    if (!w) return jsonErr("Заявка не найдена");
    await prisma.partnerWithdrawal.update({
      where: { id: body.id },
      data: { status, adminNote: (body.note || "").slice(0, 500) },
    });
    if (status === "rejected") {
      await prisma.partnerProfile.update({
        where: { id: w.partnerId },
        data: { balancePeaches: { increment: w.amountPeaches } },
      });
    }
    await writeAudit({
      actorId: actor.id,
      action: `payout_${status}`,
      targetType: "partnerWithdrawal",
      targetId: body.id,
    });
    return jsonOk({ ok: true });
  });
}
