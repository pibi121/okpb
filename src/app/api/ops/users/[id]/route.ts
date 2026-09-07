import { prisma } from "@/lib/db";
import { jsonOk, jsonErr, withOps } from "@/lib/ops/http";
import { writeAudit } from "@/lib/ops/audit";
import { creditPeaches, debitPeaches } from "@/lib/tg/wallet";
import { tgSendMessage } from "@/lib/tg/telegram-api";
import { isOpsRole } from "@/lib/ops/roles";
import { galleryStatus, parseGalleryMeta } from "@/lib/gallery-meta";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  return withOps("users", async () => {
    const user = await prisma.user.findUnique({
      where: { id },
      include: {
        platformAccounts: true,
        trafficLink: true,
        partnerProfile: true,
        partnerAttribution: { include: { partner: true, link: true } },
        characters: { orderBy: { updatedAt: "desc" }, take: 20 },
        ledger: { orderBy: { createdAt: "desc" }, take: 30 },
        galleryItems: { orderBy: { createdAt: "desc" }, take: 24 },
      },
    });
    if (!user) return jsonErr("Человек не найден", 404);
    return jsonOk({
      user: {
        ...user,
        passwordHash: undefined,
        createdAt: user.createdAt.toISOString(),
        updatedAt: user.updatedAt.toISOString(),
        blockedAt: user.blockedAt?.toISOString() || null,
        galleryItems: user.galleryItems.map((g) => ({
          id: g.id,
          kind: g.kind,
          title: g.title,
          resultUrl: g.resultUrl,
          status: galleryStatus(g.metaJson),
          error: parseGalleryMeta(g.metaJson).error || null,
          createdAt: g.createdAt.toISOString(),
        })),
        ledger: user.ledger.map((l) => ({
          ...l,
          createdAt: l.createdAt.toISOString(),
        })),
      },
    });
  });
}

export async function POST(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  return withOps("users", async (actor) => {
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) return jsonErr("Человек не найден", 404);
    const body = (await req.json()) as {
      action?: string;
      amount?: number;
      reason?: string;
      note?: string;
      text?: string;
      role?: string;
    };
    const action = body.action || "";

    if (action === "credit") {
      const amount = Math.floor(Number(body.amount) || 0);
      if (amount <= 0) return jsonErr("Сумма должна быть больше нуля");
      await creditPeaches(id, amount, "admin_credit", {
        actorId: actor.id,
        note: body.reason || "",
      });
      await writeAudit({
        actorId: actor.id,
        action: "credit",
        targetType: "user",
        targetId: id,
        detail: { amount, reason: body.reason || "" },
      });
      return jsonOk({ ok: true });
    }

    if (action === "debit") {
      const amount = Math.floor(Number(body.amount) || 0);
      if (amount <= 0) return jsonErr("Сумма должна быть больше нуля");
      const res = await debitPeaches(id, amount, "admin_debit", {
        actorId: actor.id,
        note: body.reason || "",
      });
      if (!res.ok) return jsonErr(`Не хватает персиков (сейчас ${res.balance})`);
      await writeAudit({
        actorId: actor.id,
        action: "debit",
        targetType: "user",
        targetId: id,
        detail: { amount, reason: body.reason || "" },
      });
      return jsonOk({ ok: true });
    }

    if (action === "block") {
      await prisma.user.update({
        where: { id },
        data: {
          blocked: true,
          blockedAt: new Date(),
          blockReason: (body.reason || "").slice(0, 500),
        },
      });
      await writeAudit({
        actorId: actor.id,
        action: "block",
        targetType: "user",
        targetId: id,
        detail: { reason: body.reason || "" },
      });
      return jsonOk({ ok: true });
    }

    if (action === "unblock") {
      await prisma.user.update({
        where: { id },
        data: { blocked: false, blockedAt: null, blockReason: "" },
      });
      await writeAudit({
        actorId: actor.id,
        action: "unblock",
        targetType: "user",
        targetId: id,
      });
      return jsonOk({ ok: true });
    }

    if (action === "note") {
      await prisma.user.update({
        where: { id },
        data: { adminNotes: (body.note || "").slice(0, 4000) },
      });
      await writeAudit({
        actorId: actor.id,
        action: "note",
        targetType: "user",
        targetId: id,
      });
      return jsonOk({ ok: true });
    }

    if (action === "message") {
      const text = (body.text || "").trim();
      if (!text) return jsonErr("Пустое сообщение");
      const acc = await prisma.platformAccount.findFirst({
        where: { userId: id, platform: "telegram" },
      });
      if (!acc) return jsonErr("У человека нет Telegram");
      await tgSendMessage(acc.platformUserId, text);
      await writeAudit({
        actorId: actor.id,
        action: "message",
        targetType: "user",
        targetId: id,
        detail: { text: text.slice(0, 200) },
      });
      return jsonOk({ ok: true });
    }

    if (action === "role") {
      if (actor.adminRole !== "owner") return jsonErr("Только хозяин меняет роли", 403);
      const role = (body.role || "").trim();
      if (role && !isOpsRole(role)) return jsonErr("Неизвестная роль");
      if (id === actor.id && role !== "owner") {
        return jsonErr("Нельзя снять с себя роль хозяина");
      }
      await prisma.user.update({
        where: { id },
        data: { adminRole: role },
      });
      await writeAudit({
        actorId: actor.id,
        action: "role",
        targetType: "user",
        targetId: id,
        detail: { role },
      });
      return jsonOk({ ok: true });
    }

    return jsonErr("Неизвестное действие");
  });
}
