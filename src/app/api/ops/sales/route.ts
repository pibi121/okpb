import { jsonOk, jsonErr, withOps } from "@/lib/ops/http";
import {
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

export async function GET(req: Request) {
  return withOps("analytics", async () => {
    const url = new URL(req.url);
    if (url.searchParams.get("mode") === "bounds") {
      const bounds = await getSalesDateBounds();
      return jsonOk(bounds);
    }

    const today = mskYmd();
    const bounds = await getSalesDateBounds();
    const fromYmd = url.searchParams.get("from") || today;
    const toYmd = url.searchParams.get("to") || today;
    const currency = parseCurrency(url.searchParams.get("currency"));
    const grain = parseGrain(url.searchParams.get("grain"), fromYmd, toYmd);
    const cashGrain = parseGrain(
      url.searchParams.get("cashGrain") || url.searchParams.get("grain"),
      fromYmd,
      toYmd,
    );

    if (fromYmd > toYmd) {
      return jsonErr("Дата «от» позже «до»");
    }

    const data = await collectSalesAnalytics({
      fromYmd,
      toYmd,
      currency,
      grain,
      cashGrain,
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
