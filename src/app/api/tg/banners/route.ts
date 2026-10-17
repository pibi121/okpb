import { NextResponse } from "next/server";
import { listBanners, type BannerKind } from "@/lib/tg/banners";
import { maintenanceApiBlock } from "@/lib/ops/maintenance-api";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const maintenanceBlock = await maintenanceApiBlock();
  if (maintenanceBlock) return maintenanceBlock;

  const url = new URL(req.url);
  const kind = url.searchParams.get("kind") as BannerKind | null;
  const banners = await listBanners(
    kind === "horizontal" || kind === "vertical" ? kind : undefined,
  );
  return NextResponse.json({ banners });
}
