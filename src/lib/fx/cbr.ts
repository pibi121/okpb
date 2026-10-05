/**
 * Bank of Russia daily rates. Cached in memory; no keys involved.
 * https://www.cbr.ru/scripts/XML_daily.asp
 */

const CBR_URL = "https://www.cbr.ru/scripts/XML_daily.asp";
const TTL_MS = 30 * 60 * 1000;

export type CbrRates = {
  /** ValCurs date, DD.MM.YYYY */
  asOf: string;
  /** RUB for 1 KZT */
  rubPerKzt: number;
  /** RUB for 1 UZS */
  rubPerUzs: number;
};

let cache: { at: number; rates: CbrRates } | null = null;

function readValute(
  xml: string,
  code: string,
): { nominal: number; value: number } | null {
  const re = new RegExp(
    `<CharCode>${code}</CharCode>\\s*<Nominal>(\\d+)</Nominal>[\\s\\S]*?<Value>([\\d,]+)</Value>`,
    "i",
  );
  const m = xml.match(re);
  if (!m) return null;
  const nominal = Number(m[1]);
  const value = Number(m[2]!.replace(",", "."));
  if (!Number.isFinite(nominal) || nominal <= 0) return null;
  if (!Number.isFinite(value) || value <= 0) return null;
  return { nominal, value };
}

export function parseCbrRates(xml: string): CbrRates {
  const asOf = xml.match(/Date="([^"]+)"/)?.[1] || "";
  const kzt = readValute(xml, "KZT");
  const uzs = readValute(xml, "UZS");
  if (!kzt || !uzs) {
    throw new Error("cbr_parse");
  }
  return {
    asOf,
    rubPerKzt: kzt.value / kzt.nominal,
    rubPerUzs: uzs.value / uzs.nominal,
  };
}

async function fetchCbrRates(): Promise<CbrRates> {
  const res = await fetch(CBR_URL, {
    signal: AbortSignal.timeout(20000),
    headers: { accept: "application/xml,text/xml,*/*" },
  });
  if (!res.ok) throw new Error("cbr_http");
  const xml = new TextDecoder("windows-1251").decode(await res.arrayBuffer());
  return parseCbrRates(xml);
}

export async function getCbrRates(): Promise<CbrRates> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.rates;
  try {
    const rates = await fetchCbrRates();
    cache = { at: Date.now(), rates };
    return rates;
  } catch (e) {
    if (cache) return cache.rates;
    throw e;
  }
}

/** Test hook. */
export function resetCbrRateCache(): void {
  cache = null;
}
