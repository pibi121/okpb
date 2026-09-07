import { NextResponse } from "next/server";
import { ensureDefaultBotInstance, getActiveBotUrl } from "@/lib/tg/bot-config";

/** 302 redirect to the active Telegram bot (peachbitch.com/bot). */
export async function GET() {
  await ensureDefaultBotInstance();
  const botUrl = await getActiveBotUrl();
  return NextResponse.redirect(botUrl, 302);
}
