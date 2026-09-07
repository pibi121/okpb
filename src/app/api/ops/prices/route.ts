import { jsonOk, withOps } from "@/lib/ops/http";
import { getOpsPrices, PRICE_FIELDS, setPriceOverlay } from "@/lib/ops/prices";
import { getOpsSettings, saveOpsSettings } from "@/lib/ops/settings";
import { writeAudit } from "@/lib/ops/audit";

export async function GET() {
  return withOps("prices", async () => {
    const prices = getOpsPrices();
    return jsonOk({
      fields: PRICE_FIELDS.map((f) => ({
        key: f.key,
        title: f.title,
        value: prices[f.key],
      })),
    });
  });
}

export async function POST(req: Request) {
  return withOps("prices", async (actor) => {
    const body = (await req.json()) as { prices?: Record<string, number> };
    const next = { ...getOpsPrices(), ...(body.prices || {}) };
    const json = JSON.stringify(next);
    await saveOpsSettings({ pricesJson: json });
    setPriceOverlay(json);
    await writeAudit({
      actorId: actor.id,
      action: "prices",
      targetType: "opsSetting",
      targetId: "main",
    });
    return jsonOk({ ok: true });
  });
}
