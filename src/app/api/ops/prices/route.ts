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
    // Keep template.pricePeaches cache in sync with the formula.
    try {
      const {
        priceForPhotoTemplateTier,
        priceForQuickVideoTemplate,
        priceForLoraI2vTemplate,
      } = await import("@/lib/template-pricing");
      const { prisma } = await import("@/lib/db");
      const photos = await prisma.photoTemplate.findMany({
        select: { id: true, tier: true },
      });
      for (const p of photos) {
        await prisma.photoTemplate.update({
          where: { id: p.id },
          data: { pricePeaches: priceForPhotoTemplateTier(p.tier) },
        });
      }
      const videos = await prisma.quickVideoTemplate.findMany({
        select: { id: true, shotsJson: true, durationSec: true },
      });
      for (const v of videos) {
        await prisma.quickVideoTemplate.update({
          where: { id: v.id },
          data: {
            pricePeaches: priceForQuickVideoTemplate({
              shotsJson: v.shotsJson,
              durationSec: v.durationSec,
            }),
            priceCredits: 0,
          },
        });
      }
      const loras = await prisma.loraI2vTemplate.findMany({
        select: { id: true, durationSec: true, shotsJson: true },
      });
      for (const l of loras) {
        await prisma.loraI2vTemplate.update({
          where: { id: l.id },
          data: {
            pricePeaches: priceForLoraI2vTemplate(l.durationSec, {
              shotsJson: l.shotsJson || "",
            }),
          },
        });
      }
    } catch (e) {
      console.warn(
        "[ops] template price sync failed:",
        e instanceof Error ? e.message : e,
      );
    }
    await writeAudit({
      actorId: actor.id,
      action: "prices",
      targetType: "opsSetting",
      targetId: "main",
    });
    return jsonOk({ ok: true });
  });
}
