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
    if (actor.adminRole === "partner") {
      return jsonErr("Партнёру доступен только просмотр", 403);
    }
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) return jsonErr("Человек не найден", 404);
    const body = (await req.json()) as {
      action?: string;
      amount?: number;
      reason?: string;
      note?: string;
      text?: string;
      role?: string;
      confirm?: string;
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

    if (action === "delete") {
      if (actor.adminRole !== "owner" && actor.adminRole !== "developer") {
        return jsonErr("Удалять аккаунты могут хозяин и разработка", 403);
      }
      if (id === actor.id) {
        return jsonErr("Нельзя удалить свой аккаунт");
      }
      if (user.adminRole === "owner") {
        return jsonErr("Нельзя удалить хозяина");
      }
      if (user.adminRole && actor.adminRole !== "owner") {
        return jsonErr("Сотрудников удаляет только хозяин", 403);
      }

      const confirm = String(body.confirm || "").trim();
      if (confirm !== "УДАЛИТЬ") {
        return jsonErr('Для удаления введи УДАЛИТЬ в поле подтверждения');
      }

      const tg = await prisma.platformAccount.findMany({
        where: { userId: id, platform: "telegram" },
        select: { platformUserId: true },
      });
      const characters = await prisma.character.findMany({
        where: { userId: id },
        select: { id: true },
      });
      const funnelCount = await prisma.funnelEvent.count({ where: { userId: id } });

      // Tables without Prisma FK to User (won't cascade).
      await prisma.ageGateReview.deleteMany({ where: { userId: id } });
      await prisma.tgOutbox.deleteMany({ where: { userId: id } });
      await prisma.gpuJob.updateMany({
        where: { userId: id },
        data: { userId: null },
      });

      await writeAudit({
        actorId: actor.id,
        action: "delete",
        targetType: "user",
        targetId: id,
        detail: {
          email: user.email,
          name: user.name,
          adminRole: user.adminRole || "",
          tgIds: tg.map((t) => t.platformUserId),
          funnelEventsRemoved: funnelCount,
          charactersRemoved: characters.length,
        },
      });

      // Cascades: FunnelEvent, PlatformAccount, gallery, ledger, payments, characters, …
      await prisma.user.delete({ where: { id } });

      // Best-effort disk cleanup (gallery/<userId>, characters/<characterId>).
      try {
        const fs = await import("node:fs");
        const path = await import("node:path");
        const { dataRoot, galleryRoot } = await import("@/lib/paths");
        const galDir = path.join(galleryRoot(), id);
        if (fs.existsSync(galDir)) {
          fs.rmSync(galDir, { recursive: true, force: true });
        }
        const charRoot = path.join(dataRoot(), "characters");
        for (const ch of characters) {
          const dir = path.join(charRoot, ch.id);
          if (fs.existsSync(dir)) {
            fs.rmSync(dir, { recursive: true, force: true });
          }
        }
      } catch (e) {
        console.warn(
          "[ops] user delete disk cleanup:",
          e instanceof Error ? e.message.slice(0, 160) : e,
        );
      }

      return jsonOk({ ok: true, deleted: true });
    }

    return jsonErr("Неизвестное действие");
  });
}
