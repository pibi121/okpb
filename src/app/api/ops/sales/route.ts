import { jsonOk, jsonErr, withOps } from "@/lib/ops/http";
import {
  collectFunnelStepUsers,
  collectSalesAnalytics,
  getSalesDateBounds,
  mskYmd,
  type SalesCurrency,
  type SalesGrain,
} from "@/lib/ops/sales-analytics";

export const runtime = "nodejs";

function parseCurrency(raw: string | null): SalesCurrency {
  if (raw === "peaches" || raw === "both") return raw;
  return "rub";
}

function parseGrain(raw: string | null, fromYmd: string, toYmd: string): SalesGrain {
  if (raw === "day" || raw === "week" || raw === "period") return raw;
  const from = new Date(fromYmd).getTime();
  const to = new Date(toYmd).getTime();
  const days = Math.floor((to - from) / 86_400_000) + 1;
  return days > 14 ? "week" : "day";
}

function parsePartnerIds(
  raw: string | null,
): string[] | null | undefined {
  if (raw == null || raw === "" || raw === "all") return undefined;
  if (raw === "none") return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function GET(req: Request) {
  return withOps("analytics", async () => {
    const url = new URL(req.url);
    if (url.searchParams.get("mode") === "bounds") {
      const bounds = await getSalesDateBounds();
      return jsonOk(bounds);
    }

    const today = mskYmd();
    const fromYmd = url.searchParams.get("from") || today;
    const toYmd = url.searchParams.get("to") || today;
    const partnerIds = parsePartnerIds(url.searchParams.get("partners"));

    if (fromYmd > toYmd) {
      return jsonErr("Дата «от» позже «до»");
    }

    if (url.searchParams.get("mode") === "funnel_users") {
      const step = (url.searchParams.get("step") || "").trim();
      if (!step) return jsonErr("Нужен step");
      try {
        const data = await collectFunnelStepUsers({
          fromYmd,
          toYmd,
          step,
          partnerIds,
          funnel: url.searchParams.get("funnel") === "pay" ? "pay" : "main",
          basis: url.searchParams.get("basis") === "fact" ? "fact" : "cohort",
          view:
            url.searchParams.get("view") === "dropped" ? "dropped" : "reached",
        });
        return jsonOk(data);
      } catch (e) {
        return jsonErr(e instanceof Error ? e.message : "ошибка");
      }
    }

    const bounds = await getSalesDateBounds();
    const currency = parseCurrency(url.searchParams.get("currency"));
    const grain = parseGrain(url.searchParams.get("grain"), fromYmd, toYmd);
    const cashGrain = parseGrain(
      url.searchParams.get("cashGrain") || url.searchParams.get("grain"),
      fromYmd,
      toYmd,
    );

    const data = await collectSalesAnalytics({
      fromYmd,
      toYmd,
      currency,
      grain,
      cashGrain,
      partnerIds,
    });

    return jsonOk({
      ...data,
      bounds: {
        minSignupYmd: bounds.minSignupYmd,
        maxYmd: bounds.maxYmd,
      },
    });
  });
}
