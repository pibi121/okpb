import { prisma } from "@/lib/db";
import { jsonOk, jsonErr, withOps } from "@/lib/ops/http";
import { ensureDefaultBotInstance, getActiveBotUrl } from "@/lib/tg/bot-config";
import { probeBotHealth } from "@/lib/ops/stats";
import { writeAudit } from "@/lib/ops/audit";

export async function GET() {
  return withOps("bot", async () => {
    await ensureDefaultBotInstance();
    const [activeUrl, health, rows] = await Promise.all([
      getActiveBotUrl(),
      probeBotHealth(),
      prisma.botInstance.findMany({ orderBy: { activatedAt: "desc" } }),
    ]);
    return jsonOk({
      activeUrl,
      health,
      tokenSet: Boolean(process.env.TELEGRAM_BOT_TOKEN?.trim()),
      siteBot: process.env.TELEGRAM_BOT_PUBLIC_URL || "",
      rows: rows.map((r) => ({
        ...r,
        activatedAt: r.activatedAt.toISOString(),
        retiredAt: r.retiredAt?.toISOString() || null,
        createdAt: r.createdAt.toISOString(),
      })),
    });
  });
}

export async function POST(req: Request) {
  return withOps("bot", async (actor) => {
    const body = (await req.json()) as {
      username?: string;
      notes?: string;
    };
    const username = (body.username || "").replace(/^@/, "").trim();
    if (!/^[A-Za-z0-9_]{5,32}$/.test(username)) {
      return jsonErr("Некорректное имя бота");
    }
    await prisma.botInstance.updateMany({
      where: { status: "active" },
      data: { status: "retired", retiredAt: new Date() },
    });
    const row = await prisma.botInstance.create({
      data: {
        username,
        status: "active",
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
      hint: "Токен нового бота положите в TELEGRAM_BOT_TOKEN на сервере и перезапустите. Закрепите ссылку в канале. Сайт /bot уже ведёт на нового.",
    });
  });
}
