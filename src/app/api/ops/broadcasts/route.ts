import { prisma } from "@/lib/db";
import { jsonOk, jsonErr, withOps } from "@/lib/ops/http";
import {
  BROADCAST_BUTTON_PRESETS,
  deleteBroadcast,
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
      presets: BROADCAST_BUTTON_PRESETS,
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
      mediaJson?: string;
      buttonsJson?: string;
      testTgId?: string;
      filter?: Record<string, unknown>;
    };
    if (body.action === "preview") {
      const n = await previewBroadcastAudience(JSON.stringify(body.filter || {}));
      return jsonOk({ count: n });
    }
    if (body.action === "test") {
      await sendTestBroadcast({
        actorUserId: actor.id,
        bodyRu: body.bodyRu || "",
        bodyEn: body.bodyEn || "",
        mediaUrl: body.mediaUrl,
        mediaJson: body.mediaJson,
        buttonsJson: body.buttonsJson,
        testTgId: body.testTgId,
      });
      return jsonOk({ ok: true });
    }
    if (body.action === "create") {
      if (!(body.title || "").trim() || !(body.bodyRu || "").trim()) {
        return jsonErr("Нужны название и русский текст");
      }
      const mediaJson = body.mediaJson?.trim() || "[]";
      let firstUrl = body.mediaUrl || "";
      try {
        const arr = JSON.parse(mediaJson) as Array<{ url?: string }>;
        if (!firstUrl && Array.isArray(arr) && arr[0]?.url) firstUrl = arr[0].url;
      } catch {
        /* ignore */
      }
      const row = await prisma.broadcast.create({
        data: {
          title: body.title!.trim(),
          bodyRu: body.bodyRu || "",
          bodyEn: body.bodyEn || "",
          mediaUrl: firstUrl,
          mediaJson,
          buttonsJson: body.buttonsJson?.trim() || "[]",
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
      // Validates + sets status=sending synchronously; fan-out continues in background.
      await runBroadcast(body.id);
      return jsonOk({ ok: true, status: "sending" });
    }
    if (body.action === "delete" && body.id) {
      await writeAudit({
        actorId: actor.id,
        action: "broadcast_delete",
        targetType: "broadcast",
        targetId: body.id,
      });
      await deleteBroadcast(body.id);
      return jsonOk({ ok: true });
    }
    return jsonErr("Неизвестное действие");
  });
}
