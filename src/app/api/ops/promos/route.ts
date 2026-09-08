import { prisma } from "@/lib/db";
import { jsonOk, jsonErr, withOps } from "@/lib/ops/http";
import { normalizePromoCode } from "@/lib/tg/promo-codes";
import { writeAudit } from "@/lib/ops/audit";

export async function GET() {
  return withOps("promos", async () => {
    const rows = await prisma.promoCode.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return jsonOk({
      rows: rows.map((r) => ({
        ...r,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      })),
    });
  });
}

export async function POST(req: Request) {
  return withOps("promos", async (actor) => {
    const body = (await req.json()) as {
      action?: string;
      id?: string;
      code?: string;
      amountPeaches?: number;
      maxRedemptions?: number;
      note?: string;
      enabled?: boolean;
    };

    if (body.action === "create") {
      const code = normalizePromoCode(body.code || "");
      const amount = Math.floor(Number(body.amountPeaches) || 0);
      const max = Math.floor(Number(body.maxRedemptions) || 0);
      if (!code || code.length < 3) return jsonErr("Код слишком короткий");
      if (amount < 1) return jsonErr("Сколько персиков начислять?");
      if (max < 1) return jsonErr("Сколько человек может воспользоваться?");
      try {
        const row = await prisma.promoCode.create({
          data: {
            code,
            amountPeaches: amount,
            maxRedemptions: max,
            note: (body.note || "").trim(),
            enabled: true,
          },
        });
        await writeAudit({
          actorId: actor.id,
          action: "promo_create",
          targetType: "promoCode",
          targetId: row.id,
        });
        return jsonOk({ id: row.id });
      } catch {
        return jsonErr("Такой код уже есть");
      }
    }

    if (body.action === "toggle" && body.id) {
      const row = await prisma.promoCode.findUnique({ where: { id: body.id } });
      if (!row) return jsonErr("Не найден");
      await prisma.promoCode.update({
        where: { id: body.id },
        data: { enabled: !row.enabled },
      });
      return jsonOk({ ok: true });
    }

    if (body.action === "delete" && body.id) {
      await prisma.promoCode.delete({ where: { id: body.id } });
      await writeAudit({
        actorId: actor.id,
        action: "promo_delete",
        targetType: "promoCode",
        targetId: body.id,
      });
      return jsonOk({ ok: true });
    }

    return jsonErr("Неизвестное действие");
  });
}
