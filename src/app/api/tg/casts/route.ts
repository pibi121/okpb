import { NextResponse } from "next/server";
import { listStudioCasts } from "@/lib/tg/studio-cast";
import { normalizeLocale } from "@/lib/tg/i18n";
import { ensureTgBootstrap } from "@/lib/tg/tg-bootstrap";

export async function GET(req: Request) {
  await ensureTgBootstrap();
  const url = new URL(req.url);
  const locale = normalizeLocale(url.searchParams.get("locale"));
  const casts = await listStudioCasts(locale);
  return NextResponse.json({ casts });
}
