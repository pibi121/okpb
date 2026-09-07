import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { jsonOk, jsonErr, withOps } from "@/lib/ops/http";
import { listFunnelCatalog, getFunnelStep } from "@/lib/ops/funnel-catalog";
import { formatUserFunnelTimeline } from "@/lib/ops/funnel-track";

export const runtime = "nodejs";

function parseDays(raw: string | null, fallback: number) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(90, Math.floor(n));
}

export async function GET(req: Request) {
  return withOps("analytics", async () => {
    const url = new URL(req.url);
    const mode = url.searchParams.get("mode") || "summary";
    const days = parseDays(url.searchParams.get("days"), 7);
    const from = new Date(Date.now() - days * 86_400_000);
    const sourceKind = url.searchParams.get("sourceKind") || "";
    const sourceCode = url.searchParams.get("sourceCode") || "";
    const userId = url.searchParams.get("userId") || "";
    const format = url.searchParams.get("format") || "json";

    if (mode === "catalog") {
      return jsonOk({
        catalog: listFunnelCatalog().map((s) => ({
          key: s.key,
          surface: s.surface,
          stage: s.stage,
          title: s.title,
          detail: s.detail,
        })),
      });
    }

    if (mode === "user" && userId) {
      const timeline = await formatUserFunnelTimeline(userId, 2000);
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          name: true,
          locale: true,
          createdAt: true,
          ageConfirmed: true,
          balancePeaches: true,
          trafficLink: { select: { code: true, label: true } },
          partnerAttribution: {
            select: { partner: { select: { code: true } } },
          },
          platformAccounts: {
            where: { platform: "telegram" },
            select: { platformUserId: true },
            take: 1,
          },
        },
      });
      if (!user) return jsonErr("Пользователь не найден", 404);

      const payload = {
        user: {
          id: user.id,
          name: user.name,
          locale: user.locale,
          createdAt: user.createdAt.toISOString(),
          ageConfirmed: user.ageConfirmed,
          balancePeaches: user.balancePeaches,
          tgId: user.platformAccounts[0]?.platformUserId || "",
          traffic: user.trafficLink,
          partner: user.partnerAttribution?.partner?.code || "",
        },
        timeline,
        /** Plain text block ready to paste into AI analysis */
        aiReport: [
          `# Воронка пользователя ${user.id}`,
          `TG: ${user.platformAccounts[0]?.platformUserId || "—"}`,
          `Создан: ${user.createdAt.toISOString()}`,
          `Язык: ${user.locale}`,
          `Правила: ${user.ageConfirmed ? "да" : "нет"}`,
          `Баланс: ${user.balancePeaches}`,
          `Источник: ${
            user.trafficLink
              ? `traffic/${user.trafficLink.code}`
              : user.partnerAttribution?.partner?.code
                ? `partner/${user.partnerAttribution.partner.code}`
                : "organic"
          }`,
          "",
          "## Хронология кликов и экранов",
          ...timeline.map((t) => t.aiLine),
        ].join("\n"),
      };

      if (format === "csv") {
        const header =
          "at,dayIndex,surface,eventKey,stepTitle,stepDetail,sourceKind,sourceCode,metaJson\n";
        const body = timeline
          .map((t) =>
            [
              t.at,
              t.dayIndex,
              t.surface,
              t.eventKey,
              csv(t.stepTitle),
              csv(t.stepDetail),
              t.sourceKind,
              t.sourceCode,
              csv(JSON.stringify(t.meta)),
            ].join(","),
          )
          .join("\n");
        return new NextResponse(header + body, {
          headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename="funnel-${userId}.csv"`,
          },
        });
      }

      if (format === "ai") {
        return new NextResponse(payload.aiReport, {
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Content-Disposition": `attachment; filename="funnel-${userId}.txt"`,
          },
        });
      }

      return jsonOk(payload);
    }

    if (mode === "export") {
      const where = {
        at: { gte: from },
        ...(sourceKind ? { sourceKind } : {}),
        ...(sourceCode ? { sourceCode } : {}),
      };
      const rows = await prisma.funnelEvent.findMany({
        where,
        orderBy: { at: "asc" },
        take: 20_000,
        include: {
          user: {
            select: {
              id: true,
              createdAt: true,
              locale: true,
              ageConfirmed: true,
              platformAccounts: {
                where: { platform: "telegram" },
                select: { platformUserId: true },
                take: 1,
              },
            },
          },
        },
      });

      const aiLines = rows.map((r) => {
        const tg = r.user.platformAccounts[0]?.platformUserId || "";
        return [
          r.at.toISOString(),
          `user=${r.userId}`,
          tg ? `tg=${tg}` : "",
          `день${r.dayIndex}`,
          r.surface,
          r.stepTitle,
          r.stepDetail,
          `источник=${r.sourceKind}${r.sourceCode ? ":" + r.sourceCode : ""}`,
          r.metaJson !== "{}" ? `meta=${r.metaJson}` : "",
        ]
          .filter(Boolean)
          .join(" | ");
      });

      if (format === "csv") {
        const header =
          "at,userId,tgId,dayIndex,surface,eventKey,stepTitle,stepDetail,sourceKind,sourceCode,metaJson\n";
        const body = rows
          .map((r) =>
            [
              r.at.toISOString(),
              r.userId,
              r.user.platformAccounts[0]?.platformUserId || "",
              r.dayIndex,
              r.surface,
              r.eventKey,
              csv(r.stepTitle),
              csv(r.stepDetail),
              r.sourceKind,
              r.sourceCode,
              csv(r.metaJson),
            ].join(","),
          )
          .join("\n");
        return new NextResponse(header + body, {
          headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename="funnel-${days}d.csv"`,
          },
        });
      }

      if (format === "ai") {
        const text = [
          `# Экспорт воронки за ${days} дн.`,
          `Событий: ${rows.length}`,
          sourceKind ? `Фильтр источника: ${sourceKind}:${sourceCode}` : "",
          "",
          "## Все клики (понятным языком)",
          ...aiLines,
        ]
          .filter(Boolean)
          .join("\n");
        return new NextResponse(text, {
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Content-Disposition": `attachment; filename="funnel-${days}d.txt"`,
          },
        });
      }

      return jsonOk({ days, count: rows.length, lines: aiLines });
    }

    // summary
    const whereBase = {
      at: { gte: from },
      ...(sourceKind ? { sourceKind } : {}),
      ...(sourceCode ? { sourceCode } : {}),
    };

    const [byEvent, bySource, usersTouched, recent] = await Promise.all([
      prisma.funnelEvent.groupBy({
        by: ["eventKey"],
        where: whereBase,
        _count: { _all: true },
        orderBy: { _count: { eventKey: "desc" } },
        take: 80,
      }),
      prisma.funnelEvent.groupBy({
        by: ["sourceKind", "sourceCode"],
        where: whereBase,
        _count: { _all: true },
        orderBy: { _count: { sourceKind: "desc" } },
        take: 40,
      }),
      prisma.funnelEvent.findMany({
        where: whereBase,
        distinct: ["userId"],
        select: { userId: true },
      }),
      prisma.funnelEvent.findMany({
        where: whereBase,
        orderBy: { at: "desc" },
        take: 40,
        select: {
          id: true,
          at: true,
          userId: true,
          eventKey: true,
          stepTitle: true,
          surface: true,
          sourceKind: true,
          sourceCode: true,
          dayIndex: true,
        },
      }),
    ]);

    const coreKeys = [
      "bot.start",
      "bot.rules.agree",
      "bot.welcome.after_rules",
      "bot.menu.generation",
      "bot.gen.confirm",
      "miniapp.open",
      "bot.topup.paid",
    ];
    const uniquePerKey: Record<string, number> = {};
    for (const key of coreKeys) {
      const u = await prisma.funnelEvent.findMany({
        where: { ...whereBase, eventKey: key },
        distinct: ["userId"],
        select: { userId: true },
      });
      uniquePerKey[key] = u.length;
    }

    return jsonOk({
      days,
      usersTouched: usersTouched.length,
      funnel: coreKeys.map((key) => ({
        key,
        title: getFunnelStep(key).title,
        detail: getFunnelStep(key).detail,
        uniqueUsers: uniquePerKey[key] || 0,
      })),
      topEvents: byEvent.map((r) => ({
        key: r.eventKey,
        title: getFunnelStep(r.eventKey).title,
        count: r._count._all,
      })),
      sources: bySource.map((r) => ({
        kind: r.sourceKind,
        code: r.sourceCode,
        count: r._count._all,
      })),
      recent: recent.map((r) => ({
        ...r,
        at: r.at.toISOString(),
      })),
    });
  });
}

function csv(v: string) {
  const s = String(v ?? "");
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
