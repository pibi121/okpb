import { prisma } from "@/lib/db";
import { jsonErr, jsonOk, withOps } from "@/lib/ops/http";
import { writeAudit } from "@/lib/ops/audit";
import { ensureCabinetDemo } from "@/lib/cabinet/seed";
import {
  createCabinetAccount,
  createCabinetProject,
  creditCabinetTopup,
  isCabinetRole,
  resetCabinetPassword,
  reviewCabinetWithdrawal,
  updateCabinetProject,
} from "@/lib/cabinet/service";

export const dynamic = "force-dynamic";

export async function GET() {
  return withOps("deals", async () => {
    await ensureCabinetDemo();
    const [accounts, projects, withdrawals] = await Promise.all([
      prisma.cabinetAccount.findMany({ orderBy: { createdAt: "asc" } }),
      prisma.cabinetProject.findMany({
        orderBy: { createdAt: "desc" },
        include: {
          investor: { select: { id: true, name: true, login: true } },
          buyer: { select: { id: true, name: true, login: true } },
          links: { orderBy: { createdAt: "asc" } },
          spends: { orderBy: { createdAt: "desc" } },
        },
      }),
      prisma.cabinetWithdrawal.findMany({
        where: { status: "pending" },
        orderBy: { createdAt: "asc" },
        include: { account: { select: { name: true, login: true, role: true } } },
      }),
    ]);
    return jsonOk({
      accounts: accounts.map((a) => ({
        id: a.id,
        login: a.login,
        name: a.name,
        role: a.role,
        balancePeaches: a.balancePeaches,
        totalEarnedPeaches: a.totalEarnedPeaches,
        createdAt: a.createdAt.toISOString(),
      })),
      projects: projects.map((p) => ({
        id: p.id,
        code: p.code,
        investorPct: p.investorPct,
        buyerPct: p.buyerPct,
        chatUrl: p.chatUrl,
        investor: p.investor,
        buyer: p.buyer,
        links: p.links.map((l) => ({
          id: l.id,
          label: l.label,
          purchases: l.purchases,
          purchaseGrossPeaches: l.purchaseGrossPeaches,
        })),
        spends: p.spends.map((s) => ({
          id: s.id,
          amountRub: s.amountRub,
          reportTitle: s.reportTitle,
          reportedAt: s.reportedAt?.toISOString() || null,
          createdAt: s.createdAt.toISOString(),
        })),
      })),
      withdrawals: withdrawals.map((w) => ({
        id: w.id,
        amountPeaches: w.amountPeaches,
        payoutDetails: w.payoutDetails,
        createdAt: w.createdAt.toISOString(),
        account: w.account,
      })),
    });
  });
}

export async function POST(req: Request) {
  return withOps("deals", async (actor) => {
    const body = (await req.json().catch(() => null)) as {
      action?: string;
      role?: string;
      name?: string;
      investorId?: string;
      buyerId?: string;
      chatUrl?: string;
      id?: string;
      investorPct?: number;
      buyerPct?: number;
      linkId?: string;
      gross?: number;
      mature?: boolean;
      note?: string;
    } | null;
    if (!body?.action) return jsonErr("Нужно действие");

    if (body.action === "create_account") {
      if (!isCabinetRole(String(body.role))) return jsonErr("Роль: инвестор или байер");
      const created = await createCabinetAccount({
        role: body.role,
        name: String(body.name || ""),
      });
      await writeAudit({
        actorId: actor.id,
        action: "cabinet_account_create",
        targetType: "cabinetAccount",
        targetId: created.account.id,
        detail: { login: created.account.login, role: created.account.role },
      });
      return jsonOk({
        login: created.account.login,
        password: created.password,
        role: created.account.role,
        name: created.account.name,
      });
    }

    if (body.action === "reset_password") {
      if (!body.id) return jsonErr("Нужен аккаунт");
      const reset = await resetCabinetPassword(body.id);
      await writeAudit({
        actorId: actor.id,
        action: "cabinet_password_reset",
        targetType: "cabinetAccount",
        targetId: reset.account.id,
        detail: { login: reset.account.login },
      });
      return jsonOk({ login: reset.account.login, password: reset.password });
    }

    if (body.action === "create_project") {
      const project = await createCabinetProject({
        investorId: String(body.investorId || ""),
        buyerId: String(body.buyerId || ""),
        chatUrl: String(body.chatUrl || ""),
      });
      await writeAudit({
        actorId: actor.id,
        action: "cabinet_project_create",
        targetType: "cabinetProject",
        targetId: project.id,
      });
      return jsonOk({ id: project.id });
    }

    if (body.action === "update_project") {
      if (!body.id) return jsonErr("Нужна связка");
      await updateCabinetProject({
        id: body.id,
        investorPct: Number(body.investorPct),
        buyerPct: Number(body.buyerPct),
        chatUrl: String(body.chatUrl || ""),
      });
      await writeAudit({
        actorId: actor.id,
        action: "cabinet_project_update",
        targetType: "cabinetProject",
        targetId: body.id,
        detail: { investorPct: body.investorPct, buyerPct: body.buyerPct },
      });
      return jsonOk({ ok: true });
    }

    if (body.action === "credit") {
      const result = await creditCabinetTopup({
        linkId: String(body.linkId || ""),
        gross: Number(body.gross),
        mature: Boolean(body.mature),
      });
      await writeAudit({
        actorId: actor.id,
        action: "cabinet_credit",
        targetType: "cabinetLink",
        targetId: String(body.linkId || ""),
        detail: result,
      });
      return jsonOk(result);
    }

    if (body.action === "approve" || body.action === "reject") {
      if (!body.id) return jsonErr("Нужна заявка");
      await reviewCabinetWithdrawal({
        id: body.id,
        action: body.action,
        note: body.note,
      });
      await writeAudit({
        actorId: actor.id,
        action: `cabinet_payout_${body.action}`,
        targetType: "cabinetWithdrawal",
        targetId: body.id,
      });
      return jsonOk({ ok: true });
    }

    return jsonErr("Неизвестное действие");
  });
}
