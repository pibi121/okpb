import { prisma } from "@/lib/db";
import { jsonOk, jsonErr, withOps } from "@/lib/ops/http";
import { buildCursorPrompt } from "@/lib/ops/errors";
import { writeAudit } from "@/lib/ops/audit";
import { enqueueQuickVideoJob } from "@/lib/quick-video";

export async function GET(req: Request) {
  return withOps("errors", async () => {
    const url = new URL(req.url);
    const status = url.searchParams.get("status") || "open";
    const rows = await prisma.opsError.findMany({
      where: status === "all" ? {} : { status },
      orderBy: { lastAt: "desc" },
      take: 80,
    });
    return jsonOk({
      rows: rows.map((r) => ({
        ...r,
        firstAt: r.firstAt.toISOString(),
        lastAt: r.lastAt.toISOString(),
        cursorPrompt: buildCursorPrompt(r),
      })),
    });
  });
}

export async function POST(req: Request) {
  return withOps("errors", async (actor) => {
    const body = (await req.json()) as {
      id?: string;
      status?: string;
      action?: string;
    };
    if (!body.id) return jsonErr("Нужен id");

    if (body.action === "auto_retry") {
      const row = await prisma.opsError.findUnique({ where: { id: body.id } });
      if (!row) return jsonErr("Не найдено");
      if (row.lastRefType === "quickVideoRun" && row.lastRefId) {
        const run = await prisma.quickVideoRun.findUnique({
          where: { id: row.lastRefId },
        });
        if (!run) return jsonErr("Видео-ран не найден");
        await prisma.quickVideoRun.update({
          where: { id: run.id },
          data: { status: "busy", error: null },
        });
        enqueueQuickVideoJob(run.id, run.userId);
        await prisma.opsError.update({
          where: { id: row.id },
          data: { autoRetryCount: { increment: 1 }, status: "fixing" },
        });
        await writeAudit({
          actorId: actor.id,
          action: "error_auto_retry",
          targetType: "opsError",
          targetId: row.id,
          detail: { refType: row.lastRefType, refId: row.lastRefId },
        });
        return jsonOk({ message: "Видео поставлено на повтор" });
      }
      if (row.lastRefType === "galleryItem" && row.lastRefId) {
        return jsonErr(
          "Повтор gallery-item пока вручную через /ops/jobs. Для видео-ранов кнопка работает.",
        );
      }
      return jsonErr("Для этой ошибки нет безопасного авто-повтора");
    }

    if (!body.status) return jsonErr("Нужны id и статус");
    if (!["open", "fixing", "done"].includes(body.status)) {
      return jsonErr("Статус: open / fixing / done");
    }
    await prisma.opsError.update({
      where: { id: body.id },
      data: { status: body.status },
    });
    await writeAudit({
      actorId: actor.id,
      action: "error_status",
      targetType: "opsError",
      targetId: body.id,
      detail: { status: body.status },
    });
    return jsonOk({ ok: true });
  });
}
