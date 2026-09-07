import { prisma } from "@/lib/db";
import { jsonOk, jsonErr, withOps } from "@/lib/ops/http";
import { writeAudit } from "@/lib/ops/audit";

export async function GET() {
  return withOps("money", async () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const month = new Date(today.getFullYear(), today.getMonth(), 1);
    const [inToday, inMonth, expenses, vault, stubTopups] = await Promise.all([
      prisma.ledgerEntry.aggregate({
        where: {
          amount: { gt: 0 },
          createdAt: { gte: today },
          reason: { contains: "topup" },
        },
        _sum: { amount: true },
      }),
      prisma.ledgerEntry.aggregate({
        where: {
          amount: { gt: 0 },
          createdAt: { gte: month },
          reason: { contains: "topup" },
        },
        _sum: { amount: true },
      }),
      prisma.opsExpense.findMany({ orderBy: { spentAt: "desc" }, take: 50 }),
      prisma.gpuVault.findUnique({ where: { id: "main" } }),
      prisma.ledgerEntry.count({
        where: { reason: { contains: "stub" } },
      }),
    ]);
    const spentMonth = await prisma.opsExpense.aggregate({
      where: { spentAt: { gte: month } },
      _sum: { amountRub: true },
    });
    return jsonOk({
      peachesInToday: inToday._sum.amount || 0,
      peachesInMonth: inMonth._sum.amount || 0,
      expensesMonthRub: spentMonth._sum.amountRub || 0,
      expenses: expenses.map((e) => ({
        ...e,
        spentAt: e.spentAt.toISOString(),
        createdAt: e.createdAt.toISOString(),
      })),
      vaultRub: vault?.balanceRub || 0,
      stubTopups,
      paymentsLive: false,
      note: "Живые оплаты ещё не подключены. Персики из заглушки — не выручка. Расходы вносите руками.",
    });
  });
}

export async function POST(req: Request) {
  return withOps("money", async (actor) => {
    const body = (await req.json()) as {
      title?: string;
      amountRub?: number;
      category?: string;
      note?: string;
    };
    const title = (body.title || "").trim();
    const amountRub = Math.floor(Number(body.amountRub) || 0);
    if (!title || amountRub === 0) return jsonErr("Нужны название и сумма в рублях");
    const row = await prisma.opsExpense.create({
      data: {
        title,
        amountRub,
        category: (body.category || "other").slice(0, 40),
        note: (body.note || "").slice(0, 500),
      },
    });
    await writeAudit({
      actorId: actor.id,
      action: "expense",
      targetType: "opsExpense",
      targetId: row.id,
      detail: { amountRub, title },
    });
    return jsonOk({ ok: true });
  });
}
