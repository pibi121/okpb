import { prisma } from "@/lib/db";
import { jsonOk, jsonErr, withOps } from "@/lib/ops/http";
import { FUNNEL_SLOTS, MEDIA_COPY_SLOTS, loadCopyOverlay } from "@/lib/ops/copy";
import { M } from "@/lib/tg/i18n";
import { writeAudit } from "@/lib/ops/audit";

export async function GET() {
  return withOps("copy", async () => {
    const rows = await prisma.botCopy.findMany();
    const bySlot = Object.fromEntries(rows.map((r) => [r.slot, r]));
    return jsonOk({
      texts: FUNNEL_SLOTS.map((s) => ({
        slot: s.slot,
        title: s.title,
        textRu: bySlot[s.slot]?.textRu || M[s.slot]?.ru || "",
        textEn: bySlot[s.slot]?.textEn || M[s.slot]?.en || "",
        mediaUrl: bySlot[s.slot]?.mediaUrl || "",
      })),
      media: MEDIA_COPY_SLOTS.map((s) => ({
        slot: s.slot,
        dbSlot: s.dbSlot,
        title: s.title,
        mediaUrl: bySlot[s.dbSlot]?.mediaUrl || "",
      })),
    });
  });
}

export async function POST(req: Request) {
  return withOps("copy", async (actor) => {
    const body = (await req.json()) as {
      slot?: string;
      textRu?: string;
      textEn?: string;
      mediaUrl?: string;
    };
    if (!body.slot) return jsonErr("Нет слота");
    await prisma.botCopy.upsert({
      where: { slot: body.slot },
      create: {
        slot: body.slot,
        textRu: body.textRu || "",
        textEn: body.textEn || "",
        mediaUrl: body.mediaUrl || "",
      },
      update: {
        textRu: body.textRu ?? undefined,
        textEn: body.textEn ?? undefined,
        mediaUrl: body.mediaUrl ?? undefined,
      },
    });
    await loadCopyOverlay();
    await writeAudit({
      actorId: actor.id,
      action: "bot_copy",
      targetType: "botCopy",
      targetId: body.slot,
    });
    return jsonOk({ ok: true });
  });
}
