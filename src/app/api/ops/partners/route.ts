import { prisma } from "@/lib/db";
import { jsonOk, jsonErr, withOps } from "@/lib/ops/http";
import { listPendingPartnerWithdrawals } from "@/lib/tg/partner-admin";
import { writeAudit } from "@/lib/ops/audit";
import { clampPartnerCommissionPct } from "@/lib/tg/partner-program";

export async function GET() {
  return withOps("partners", async () => {
    const [partners, pending] = await Promise.all([
      prisma.partnerProfile.findMany({
        orderBy: { totalEarnedPeaches: "desc" },
        take: 200,
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
      commissionPct?: number;
    };
    if (!body.id || !body.action) return jsonErr("Нужны id и действие");

    if (body.action === "set_commission") {
      const pct = clampPartnerCommissionPct(body.commissionPct);
      if (pct === null) {
        return jsonErr("Процент комиссии: целое число от 0 до 100");
      }
      const prev = await prisma.partnerProfile.findUnique({
        where: { id: body.id },
        select: { id: true, code: true, commissionPct: true },
      });
      if (!prev) return jsonErr("Партнёр не найден");
      const updated = await prisma.partnerProfile.update({
        where: { id: body.id },
        data: { commissionPct: pct },
        select: {
          id: true,
          code: true,
          commissionPct: true,
          user: { select: { name: true, email: true } },
        },
      });
      await writeAudit({
        actorId: actor.id,
        action: "partner_set_commission",
        targetType: "partnerProfile",
        targetId: body.id,
        detail: {
          code: prev.code,
          from: prev.commissionPct,
          to: pct,
        },
      });
      return jsonOk({ ok: true, partner: updated });
    }

    if (body.action !== "approve" && body.action !== "reject") {
      return jsonErr("approve, reject или set_commission");
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
