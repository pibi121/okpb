import { prisma } from "@/lib/db";
import { jsonOk, jsonErr, withOps } from "@/lib/ops/http";
import { NOTICE_SLOTS, invalidateNotices, seedSystemNotices } from "@/lib/ops/notices";
import { writeAudit } from "@/lib/ops/audit";

export async function GET() {
  return withOps("notices", async () => {
    await seedSystemNotices();
    const rows = await prisma.systemNotice.findMany({ orderBy: { slot: "asc" } });
    const titles = Object.fromEntries(NOTICE_SLOTS.map((n) => [n.slot, n.title]));
    return jsonOk({
      rows: rows.map((r) => ({
        ...r,
        title: titles[r.slot] || r.title,
        updatedAt: r.updatedAt.toISOString(),
      })),
    });
  });
}

export async function POST(req: Request) {
  return withOps("notices", async (actor) => {
    const body = (await req.json()) as {
      slot?: string;
      textRu?: string;
      textEn?: string;
      enabled?: boolean;
      mediaUrl?: string;
    };
    if (!body.slot) return jsonErr("Нет слота");
    await prisma.systemNotice.update({
      where: { slot: body.slot },
      data: {
        textRu: body.textRu ?? undefined,
        textEn: body.textEn ?? undefined,
        enabled: typeof body.enabled === "boolean" ? body.enabled : undefined,
        mediaUrl: body.mediaUrl ?? undefined,
      },
    });
    invalidateNotices();
    await writeAudit({
      actorId: actor.id,
      action: "notice",
      targetType: "systemNotice",
      targetId: body.slot,
    });
    return jsonOk({ ok: true });
  });
}
