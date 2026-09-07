import { NextResponse } from "next/server";
import { ensureDefaultBotInstance, getActiveBotUrl } from "@/lib/tg/bot-config";

export async function GET() {
  await ensureDefaultBotInstance();
  const botUrl = await getActiveBotUrl();
  return NextResponse.json({ botUrl });
}
