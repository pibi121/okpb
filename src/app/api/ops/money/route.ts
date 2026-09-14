import { prisma } from "@/lib/db";
import { jsonOk, jsonErr, withOps } from "@/lib/ops/http";
import { writeAudit } from "@/lib/ops/audit";
import { z } from "zod";

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
      paymentsLive: Boolean(
        process.env.CASHERA_API_KEY?.trim() &&
          process.env.CASHERA_API_SECRET?.trim(),
      ),
      note: process.env.CASHERA_API_KEY?.trim()
        ? "Cashera подключён: SBP / карта / крипта. Партнёрка 50% с topup."
        : "Живые оплаты: задайте CASHERA_API_KEY и CASHERA_API_SECRET. Stub-персики — не выручка.",
    });
  });
}

export async function POST(req: Request) {
  return withOps("money", async (actor) => {
    if (actor.adminRole === "partner") {
      return jsonErr("Партнёру доступен только просмотр", 403);
    }
    const bodySchema = z.object({
      title: z.string().min(1).max(200),
      amountRub: z.number().int().min(1).max(10_000_000),
      category: z.string().max(40).optional(),
      note: z.string().max(500).optional(),
    });
    const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return jsonErr("Нужны корректные название и сумма в рублях");
    }
    const { title, amountRub, category, note } = parsed.data;
    const row = await prisma.opsExpense.create({
      data: {
        title,
        amountRub,
        category: category || "other",
        note: note || "",
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
