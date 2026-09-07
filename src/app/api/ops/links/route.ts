import { prisma } from "@/lib/db";
import { jsonOk, jsonErr, withOps } from "@/lib/ops/http";
import { normalizeLinkCode, trafficStartUrl } from "@/lib/ops/traffic";
import { writeAudit } from "@/lib/ops/audit";

export async function GET() {
  return withOps("links", async () => {
    const rows = await prisma.trafficLink.findMany({
      orderBy: { createdAt: "desc" },
    });
    const urls = await Promise.all(
      rows.map(async (r) => ({
        ...r,
        createdAt: r.createdAt.toISOString(),
        url: await trafficStartUrl(r.code),
      })),
    );
    return jsonOk({ rows: urls });
  });
}

export async function POST(req: Request) {
  return withOps("links", async (actor) => {
    const body = (await req.json()) as {
      code?: string;
      label?: string;
      note?: string;
    };
    const code = normalizeLinkCode(body.code || "");
    const label = (body.label || "").trim();
    if (!code || !label) return jsonErr("Нужны короткий код и название");
    const row = await prisma.trafficLink.create({
      data: { code, label, note: (body.note || "").slice(0, 500) },
    });
    await writeAudit({
      actorId: actor.id,
      action: "traffic_link",
      targetType: "trafficLink",
      targetId: row.id,
      detail: { code },
    });
    return jsonOk({ row, url: await trafficStartUrl(code) });
  });
}
