import { prisma } from "@/lib/db";
import { jsonOk, jsonErr, withOps } from "@/lib/ops/http";
import { ensureDefaultBotInstance, getActiveBotUrl } from "@/lib/tg/bot-config";
import { probeBotHealth, probeAllBotsHealth } from "@/lib/ops/stats";
import { writeAudit } from "@/lib/ops/audit";
import {
  addDualBot,
  retireBot,
  setPrimaryBot,
  listLiveBots,
} from "@/lib/tg/bot-registry";
import { maskToken } from "@/lib/tg/bot-secrets";

export async function GET() {
  return withOps("bot", async () => {
    await ensureDefaultBotInstance();
    const [activeUrl, health, allHealth, rows, live] = await Promise.all([
      getActiveBotUrl(),
      probeBotHealth(),
      probeAllBotsHealth(),
      prisma.botInstance.findMany({ orderBy: [{ isPrimary: "desc" }, { activatedAt: "desc" }] }),
      listLiveBots(),
    ]);
    return jsonOk({
      activeUrl,
      health,
      botsHealth: allHealth,
      tokenSet: Boolean(process.env.TELEGRAM_BOT_TOKEN?.trim()),
      liveCount: live.length,
      siteBot: process.env.TELEGRAM_BOT_PUBLIC_URL || "",
      rows: rows.map((r) => ({
        id: r.id,
        username: r.username,
        status: r.status,
        isPrimary: r.isPrimary,
        hasToken: Boolean(r.tokenEnc) || (r.isPrimary && Boolean(process.env.TELEGRAM_BOT_TOKEN?.trim())),
        telegramBotId: r.telegramBotId || null,
        notes: r.notes,
        activatedAt: r.activatedAt.toISOString(),
        retiredAt: r.retiredAt?.toISOString() || null,
      })),
    });
  });
}

export async function POST(req: Request) {
  return withOps("bot", async (actor) => {
    const body = (await req.json()) as {
      action?: string;
      token?: string;
      username?: string;
      notes?: string;
      id?: string;
      makePrimary?: boolean;
    };

    const action = body.action || "set_primary_username";

    if (action === "add_dual") {
      try {
        const result = await addDualBot({
          token: String(body.token || ""),
          notes: body.notes,
          makePrimary: body.makePrimary === true,
        });
        await writeAudit({
          actorId: actor.id,
          action: "bot_add_dual",
          targetType: "botInstance",
          targetId: result.row.id,
          detail: {
            username: result.row.username,
            makePrimary: Boolean(body.makePrimary),
            token: maskToken(String(body.token || "")),
          },
        });
        return jsonOk({
          ok: true,
          message: result.message,
          username: result.row.username,
          id: result.row.id,
          hint: "Polling подхватит нового бота за ~15 сек после деплоя (hot-reload списка). Старый primary не останавливали.",
        });
      } catch (e) {
        return jsonErr(e instanceof Error ? e.message : String(e));
      }
    }

    if (action === "set_primary") {
      const id = String(body.id || "");
      if (!id) return jsonErr("Нужен id бота");
      try {
        const row = await setPrimaryBot(id);
        await writeAudit({
          actorId: actor.id,
          action: "bot_set_primary",
          targetType: "botInstance",
          targetId: row.id,
          detail: { username: row.username },
        });
        return jsonOk({
          ok: true,
          message: `Primary теперь @${row.username}. Dual-боты продолжают работать.`,
          url: `https://t.me/${row.username}`,
        });
      } catch (e) {
        return jsonErr(e instanceof Error ? e.message : String(e));
      }
    }

    if (action === "retire") {
      const id = String(body.id || "");
      if (!id) return jsonErr("Нужен id бота");
      try {
        const row = await retireBot(id);
        await writeAudit({
          actorId: actor.id,
          action: "bot_retire",
          targetType: "botInstance",
          targetId: row.id,
          detail: { username: row.username },
        });
        return jsonOk({
          ok: true,
          message: `@${row.username} выведен из dual (retired). Primary не тронут.`,
        });
      } catch (e) {
        return jsonErr(e instanceof Error ? e.message : String(e));
      }
    }

    // Legacy: mark username as primary public link (no token) — keep for cutover notes
    const username = (body.username || "").replace(/^@/, "").trim();
    if (!/^[A-Za-z0-9_]{5,32}$/.test(username)) {
      return jsonErr("Некорректное имя бота");
    }
    const existing = await prisma.botInstance.findFirst({
      where: { username },
      orderBy: { activatedAt: "desc" },
    });
    await prisma.botInstance.updateMany({
      where: { isPrimary: true },
      data: { isPrimary: false },
    });
    const row = existing
      ? await prisma.botInstance.update({
          where: { id: existing.id },
          data: {
            status: "active",
            isPrimary: true,
            retiredAt: null,
            notes: (body.notes || existing.notes || "").slice(0, 1000),
            activatedAt: new Date(),
          },
        })
      : await prisma.botInstance.create({
          data: {
            username,
            status: "active",
            isPrimary: true,
            notes: (body.notes || "").slice(0, 1000),
          },
        });
    await writeAudit({
      actorId: actor.id,
      action: "bot_switch",
      targetType: "botInstance",
      targetId: row.id,
      detail: { username },
    });
    return jsonOk({
      ok: true,
      url: `https://t.me/${username}`,
      hint: "Ссылка /bot обновлена. Для dual с токеном используйте форму «Добавить dual-бота».",
    });
  });
}
