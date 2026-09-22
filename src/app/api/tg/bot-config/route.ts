import { NextResponse } from "next/server";
import {
  ensureDefaultBotInstance,
  getActiveBotUrl,
  getPrimaryBotUsername,
} from "@/lib/tg/bot-config";

/** Public Mini App helpers (no auth) — used to recover when reply-keyboard WebApp opens without initData. */
export async function GET() {
  await ensureDefaultBotInstance();
  const botUsername = await getPrimaryBotUsername();
  const botUrl = await getActiveBotUrl();
  return NextResponse.json({
    botUrl,
    botUsername,
    startAppUrl: `https://t.me/${botUsername}?startapp=1`,
  });
}
