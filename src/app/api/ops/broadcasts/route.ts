import { prisma } from "@/lib/db";
import { jsonOk, jsonErr, withOps } from "@/lib/ops/http";
import {
  BROADCAST_BUTTON_PRESETS,
  deleteBroadcast,
  listBroadcastBotOptions,
  listBroadcastButtonCatalog,
  previewBroadcastAudience,
  runBroadcast,
  scheduleBroadcast,
  sendTestBroadcast,
  unscheduleBroadcast,
  updateBroadcast,
} from "@/lib/ops/broadcast";
import { writeAudit } from "@/lib/ops/audit";
import { normalizeBroadcastBody } from "@/lib/ops/telegram-html";
import { parseMskDateTimeLocal } from "@/lib/ops/msk-time";

function parseScheduledAt(raw: unknown): Date | null {
  if (raw == null || raw === "") return null;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  // Prefer MSK datetime-local from ops UI.
  const msk = parseMskDateTimeLocal(trimmed);
  if (msk) return msk;
  const d = new Date(trimmed);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

export async function GET() {
  return withOps("broadcasts", async () => {
    const [rows, bots, catalog] = await Promise.all([
      prisma.broadcast.findMany({
        orderBy: { createdAt: "desc" },
        take: 40,
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
        scheduledAt: r.scheduledAt?.toISOString() || null,
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
      scheduledAt?: string | null;
      scheduleOnly?: boolean;
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
        bodyRu: normalizeBroadcastBody(body.bodyRu || ""),
        bodyEn: normalizeBroadcastBody(body.bodyEn || ""),
        mediaUrl: body.mediaUrl,
        mediaJson: body.mediaJson,
        buttonsJson: body.buttonsJson,
        testTgId: body.testTgId,
        botIds,
      });
      return jsonOk({ ok: true, results });
    }

    if (body.action === "create") {
      const bodyRu = normalizeBroadcastBody(body.bodyRu || "");
      const bodyEn = normalizeBroadcastBody(body.bodyEn || "");
      if (!(body.title || "").trim() || !bodyRu.trim()) {
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
      const scheduledAt = parseScheduledAt(body.scheduledAt);
      if (body.scheduleOnly || scheduledAt) {
        if (!scheduledAt) {
          return jsonErr("Укажи дату и время (МСК) для отложенной рассылки");
        }
        if (scheduledAt.getTime() <= Date.now() - 30_000) {
          return jsonErr("Время отправки должно быть в будущем (МСК)");
        }
      }
      const row = await prisma.broadcast.create({
        data: {
          title: body.title!.trim(),
          bodyRu,
          bodyEn,
          mediaUrl: firstUrl,
          mediaJson,
          buttonsJson: body.buttonsJson?.trim() || "[]",
          filterJson: JSON.stringify(filter),
          createdById: actor.id,
          status: scheduledAt ? "scheduled" : "draft",
          scheduledAt: scheduledAt || null,
        },
      });
      if (scheduledAt) {
        await writeAudit({
          actorId: actor.id,
          action: "broadcast_schedule",
          targetType: "broadcast",
          targetId: row.id,
          detail: { scheduledAt: scheduledAt.toISOString() },
        });
      }
      return jsonOk({
        id: row.id,
        status: row.status,
        scheduledAt: row.scheduledAt?.toISOString() || null,
      });
    }

    if (body.action === "update" && body.id) {
      const bodyRu =
        body.bodyRu !== undefined
          ? normalizeBroadcastBody(body.bodyRu)
          : undefined;
      const bodyEn =
        body.bodyEn !== undefined
          ? normalizeBroadcastBody(body.bodyEn)
          : undefined;
      if (bodyRu !== undefined && !bodyRu.trim()) {
        return jsonErr("Русский текст не может быть пустым");
      }
      const mediaJson = body.mediaJson?.trim();
      let firstUrl = body.mediaUrl;
      if (mediaJson && firstUrl === undefined) {
        try {
          const arr = JSON.parse(mediaJson) as Array<{ url?: string }>;
          if (Array.isArray(arr) && arr[0]?.url) firstUrl = arr[0].url;
        } catch {
          /* ignore */
        }
      }
      const filter =
        body.filter || botIds
          ? JSON.stringify({
              ...(body.filter || {}),
              ...(botIds?.length ? { botIds } : {}),
            })
          : undefined;
      const scheduledAt =
        body.scheduledAt === undefined
          ? undefined
          : body.scheduledAt === null || body.scheduledAt === ""
            ? null
            : parseScheduledAt(body.scheduledAt);
      if (body.scheduledAt && scheduledAt === null && body.scheduledAt !== "") {
        return jsonErr("Некорректная дата/время (МСК)");
      }
      const row = await updateBroadcast(body.id, {
        title: body.title,
        bodyRu,
        bodyEn,
        mediaUrl: firstUrl,
        mediaJson,
        buttonsJson: body.buttonsJson?.trim(),
        filterJson: filter,
        scheduledAt,
      });
      await writeAudit({
        actorId: actor.id,
        action: "broadcast_update",
        targetType: "broadcast",
        targetId: body.id,
      });
      return jsonOk({
        id: row.id,
        status: row.status,
        scheduledAt: row.scheduledAt?.toISOString() || null,
      });
    }

    if (body.action === "schedule" && body.id) {
      const scheduledAt = parseScheduledAt(body.scheduledAt);
      if (!scheduledAt) {
        return jsonErr("Укажи дату и время (МСК)");
      }
      const row = await scheduleBroadcast(body.id, scheduledAt);
      await writeAudit({
        actorId: actor.id,
        action: "broadcast_schedule",
        targetType: "broadcast",
        targetId: body.id,
        detail: { scheduledAt: scheduledAt.toISOString() },
      });
      return jsonOk({
        id: row.id,
        status: row.status,
        scheduledAt: row.scheduledAt?.toISOString() || null,
      });
    }

    if (body.action === "unschedule" && body.id) {
      const row = await unscheduleBroadcast(body.id);
      await writeAudit({
        actorId: actor.id,
        action: "broadcast_unschedule",
        targetType: "broadcast",
        targetId: body.id,
      });
      return jsonOk({ id: row.id, status: row.status });
    }

    if (body.action === "send" && body.id) {
      await writeAudit({
        actorId: actor.id,
        action: "broadcast_send",
        targetType: "broadcast",
        targetId: body.id,
      });
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
