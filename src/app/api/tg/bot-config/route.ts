import { NextResponse } from "next/server";
import {
  ensureDefaultBotInstance,
  getActiveBotUrl,
  getPrimaryBotUsername,
} from "@/lib/tg/bot-config";
import { maintenanceApiBlock } from "@/lib/ops/maintenance-api";

/** Public bot deep-link helpers (no auth). */
export async function GET() {
  const maintenanceBlock = await maintenanceApiBlock();
  if (maintenanceBlock) return maintenanceBlock;

  await ensureDefaultBotInstance();
  const botUsername = await getPrimaryBotUsername();
  const botUrl = await getActiveBotUrl();
  return NextResponse.json({
    botUrl,
    botUsername,
  });
}
