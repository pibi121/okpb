import { prisma } from "@/lib/db";
import { jsonOk, jsonErr, withOps } from "@/lib/ops/http";
import { listPendingPartnerWithdrawals } from "@/lib/tg/partner-admin";
import { writeAudit } from "@/lib/ops/audit";
import {
  clampPartnerCommissionPct,
  partnerFrozenCommissionPeachesByIds,
  partnerHoldOnBalance,
} from "@/lib/tg/partner-program";
import { notifyPartnersChatPayout } from "@/lib/tg/partner-payout-notify";

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
    const frozenById = await partnerFrozenCommissionPeachesByIds(
      partners.map((p) => p.id),
    );
    return jsonOk({
      partners: partners.map((p) => {
        const frozenCommissions = frozenById.get(p.id) || 0;
        const holdOnBalance = partnerHoldOnBalance(
          p.balancePeaches,
          frozenCommissions,
        );
        return {
          ...p,
          createdAt: p.createdAt.toISOString(),
          /** Real: commissions &lt; 3d that still sit on current balance. */
          holdPeaches: holdOnBalance,
          availablePeaches: Math.max(0, p.balancePeaches - holdOnBalance),
        };
      }),
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
      volumeBonusPeaches?: number;
      amountPeaches?: number;
    };

    if (body.action === "fake_payout") {
      const amount = Math.floor(Number(body.amountPeaches));
      if (!Number.isFinite(amount) || amount < 1) {
        return jsonErr("Сумма: целое число ≥ 1");
      }
      const bonusRaw = Number(body.volumeBonusPeaches ?? 0);
      const bonus = Number.isFinite(bonusRaw)
        ? Math.max(0, Math.floor(bonusRaw))
        : 0;
      const w = await prisma.partnerWithdrawal.create({
        data: {
          partnerId: null,
          amountPeaches: amount,
          volumeBonusPeaches: bonus,
          isFake: true,
          status: "paid",
          adminNote: (body.note || "fake_payout").slice(0, 500),
          payoutDetails: "",
        },
      });
      const notify = await notifyPartnersChatPayout({
        amountPeaches: amount,
        volumeBonusPeaches: bonus,
      });
      await writeAudit({
        actorId: actor.id,
        action: "payout_fake",
        targetType: "partnerWithdrawal",
        targetId: w.id,
        detail: { amount, bonus, notify },
      });
      return jsonOk({ ok: true, id: w.id, notify });
    }

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
      return jsonErr("approve, reject, set_commission или fake_payout");
    }
    const status = body.action === "approve" ? "paid" : "rejected";
    const w = await prisma.partnerWithdrawal.findUnique({
      where: { id: body.id },
    });
    if (!w) return jsonErr("Заявка не найдена");
    if (w.isFake) return jsonErr("Фейковая заявка уже закрыта");

    let volumeBonusPeaches = w.volumeBonusPeaches || 0;
    if (status === "paid") {
      const bonusRaw = Number(body.volumeBonusPeaches ?? volumeBonusPeaches);
      if (!Number.isFinite(bonusRaw) || bonusRaw < 0) {
        return jsonErr("Премия за объём: число ≥ 0");
      }
      volumeBonusPeaches = Math.floor(bonusRaw);
    }

    await prisma.partnerWithdrawal.update({
      where: { id: body.id },
      data: {
        status,
        adminNote: (body.note || "").slice(0, 500),
        ...(status === "paid" ? { volumeBonusPeaches } : {}),
      },
    });
    if (status === "rejected" && w.partnerId) {
      await prisma.partnerProfile.update({
        where: { id: w.partnerId },
        data: { balancePeaches: { increment: w.amountPeaches } },
      });
    }

    let notify: { ok: boolean; skipped?: boolean; error?: string } | undefined;
    if (status === "paid") {
      notify = await notifyPartnersChatPayout({
        amountPeaches: w.amountPeaches,
        volumeBonusPeaches,
      });
    }

    await writeAudit({
      actorId: actor.id,
      action: `payout_${status}`,
      targetType: "partnerWithdrawal",
      targetId: body.id,
      detail: status === "paid" ? { volumeBonusPeaches, notify } : undefined,
    });
    return jsonOk({ ok: true, notify });
  });
}
