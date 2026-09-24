import { prisma } from "@/lib/db";
import { jsonOk, jsonErr, withOps } from "@/lib/ops/http";
import {
  BROADCAST_BUTTON_PRESETS,
  deleteBroadcast,
  listBroadcastBotOptions,
  listBroadcastButtonCatalog,
  previewBroadcastAudience,
  runBroadcast,
  sendTestBroadcast,
} from "@/lib/ops/broadcast";
import { writeAudit } from "@/lib/ops/audit";

export async function GET() {
  return withOps("broadcasts", async () => {
    const [rows, bots, catalog] = await Promise.all([
      prisma.broadcast.findMany({
        orderBy: { createdAt: "desc" },
        take: 30,
      }),
      listBroadcastBotOptions().catch(() => []),
      listBroadcastButtonCatalog().catch(() => []),
    ]);
    return jsonOk({
      presets: BROADCAST_BUTTON_PRESETS,
      catalog,
      bots,
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
      botIds?: string[];
      filter?: Record<string, unknown>;
    };
    const botIds = Array.isArray(body.botIds)
      ? body.botIds.filter(
          (x): x is string => typeof x === "string" && x.trim().length > 0,
        )
      : undefined;
    if (body.action === "preview") {
      const n = await previewBroadcastAudience(
        JSON.stringify(body.filter || {}),
      );
      return jsonOk({ count: n });
    }
    if (body.action === "test") {
      const { results } = await sendTestBroadcast({
        actorUserId: actor.id,
        bodyRu: body.bodyRu || "",
        bodyEn: body.bodyEn || "",
        mediaUrl: body.mediaUrl,
        mediaJson: body.mediaJson,
        buttonsJson: body.buttonsJson,
        testTgId: body.testTgId,
        botIds,
      });
      return jsonOk({ ok: true, results });
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
      const filter = {
        ...(body.filter || {}),
        ...(botIds?.length ? { botIds } : {}),
      };
      const row = await prisma.broadcast.create({
        data: {
          title: body.title!.trim(),
          bodyRu: body.bodyRu || "",
          bodyEn: body.bodyEn || "",
          mediaUrl: firstUrl,
          mediaJson,
          buttonsJson: body.buttonsJson?.trim() || "[]",
          filterJson: JSON.stringify(filter),
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
