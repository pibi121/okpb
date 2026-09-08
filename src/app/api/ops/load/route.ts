import { jsonOk, jsonErr, withOps } from "@/lib/ops/http";
import { applyLoadAction, collectLoadDashboard } from "@/lib/gpu/load-stats";
import { writeAudit } from "@/lib/ops/audit";
import { saveOpsSettings } from "@/lib/ops/settings";

export async function GET() {
  return withOps("load", async () => {
    const data = await collectLoadDashboard({ ping: true });
    return jsonOk(data);
  });
}

export async function POST(req: Request) {
  return withOps("load", async (actor) => {
    const body = (await req.json()) as {
      action?: string;
      sloJson?: string;
      [key: string]: unknown;
    };
    if (body.sloJson !== undefined) {
      try {
        JSON.parse(body.sloJson || "{}");
      } catch {
        return jsonErr("sloJson должен быть JSON");
      }
      await saveOpsSettings({ sloJson: body.sloJson || "{}" });
      await writeAudit({
        actorId: actor.id,
        action: "slo_update",
        targetType: "opsSetting",
        targetId: "main",
      });
      return jsonOk({ ok: true, message: "Эталоны сохранены" });
    }
    if (!body.action) return jsonErr("Нужно action");
    try {
      const result = await applyLoadAction(body.action, actor.id, body);
      await writeAudit({
        actorId: actor.id,
        action: `load_${body.action}`,
        targetType: "gpu",
        targetId: typeof body.id === "string" ? body.id : "",
        detail: { ok: result.ok, message: result.message },
      });
      if (!result.ok) return jsonErr(result.message);
      return jsonOk(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return jsonErr(msg);
    }
  });
}
