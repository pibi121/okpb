import { prisma } from "@/lib/db";
import { jsonOk, jsonErr, withOps } from "@/lib/ops/http";
import {
  previewBroadcastAudience,
  runBroadcast,
  sendTestBroadcast,
} from "@/lib/ops/broadcast";
import { writeAudit } from "@/lib/ops/audit";

export async function GET() {
  return withOps("broadcasts", async () => {
    const rows = await prisma.broadcast.findMany({
      orderBy: { createdAt: "desc" },
      take: 30,
    });
    return jsonOk({
      rows: rows.map((r) => ({
        ...r,
        createdAt: r.createdAt.toISOString(),
        sentAt: r.sentAt?.toISOString() || null,
      })),
    });
  });
}

export async function POST(req: Request) {
  return withOps("broadcasts", async (actor) => {
    const body = (await req.json()) as {
      action?: string;
      id?: string;
      title?: string;
      bodyRu?: string;
      bodyEn?: string;
      mediaUrl?: string;
      filter?: Record<string, unknown>;
    };
    if (body.action === "preview") {
      const n = await previewBroadcastAudience(JSON.stringify(body.filter || {}));
      return jsonOk({ count: n });
    }
    if (body.action === "test") {
      await sendTestBroadcast(
        actor.id,
        body.bodyRu || "",
        body.bodyEn || "",
        body.mediaUrl,
      );
      return jsonOk({ ok: true });
    }
    if (body.action === "create") {
      if (!(body.title || "").trim() || !(body.bodyRu || "").trim()) {
        return jsonErr("Нужны название и русский текст");
      }
      const row = await prisma.broadcast.create({
        data: {
          title: body.title!.trim(),
          bodyRu: body.bodyRu || "",
          bodyEn: body.bodyEn || "",
          mediaUrl: body.mediaUrl || "",
          filterJson: JSON.stringify(body.filter || {}),
          createdById: actor.id,
          status: "draft",
        },
      });
      return jsonOk({ id: row.id });
    }
    if (body.action === "send" && body.id) {
      await writeAudit({
        actorId: actor.id,
        action: "broadcast_send",
        targetType: "broadcast",
        targetId: body.id,
      });
      void runBroadcast(body.id).catch((e) =>
        console.error("[ops] broadcast:", e),
      );
      return jsonOk({ ok: true });
    }
    return jsonErr("Неизвестное действие");
  });
}
