import { NextResponse } from "next/server";
import { resolveTgApiUserId } from "@/lib/tg/resolve-api-user";
import { recordMiniAppVisit } from "@/lib/tg/tg-promo";
import { maintenanceApiBlock } from "@/lib/ops/maintenance-api";

/** Mini App heartbeat — activates daily studio free when eligible. */
export async function POST(req: Request) {
  const maintenanceBlock = await maintenanceApiBlock();
  if (maintenanceBlock) return maintenanceBlock;

  const userId = await resolveTgApiUserId(req);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await recordMiniAppVisit(userId);
  return NextResponse.json({ ok: true });
}
