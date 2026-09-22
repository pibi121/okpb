import { NextResponse } from "next/server";
import {
  ensureDefaultBotInstance,
  getActiveBotUrl,
  getPrimaryBotUsername,
} from "@/lib/tg/bot-config";

/** Public bot deep-link helpers (no auth). */
export async function GET() {
  await ensureDefaultBotInstance();
  const botUsername = await getPrimaryBotUsername();
  const botUrl = await getActiveBotUrl();
  return NextResponse.json({
    botUrl,
    botUsername,
  });
}
