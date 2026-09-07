import { NextResponse } from "next/server";
import {
  handleTgMessage,
  handleTgCallbackQuery,
  flushTgOutbox,
} from "@/lib/tg/bot-update";
import { ensureTgBootstrap } from "@/lib/tg/tg-bootstrap";
import { pollTgLoraTrainings } from "@/lib/tg/lora-train-poller";

/** Throttle LoRA completion polls — webhook traffic is frequent. */
let lastLoraPollAt = 0;
const LORA_POLL_EVERY_MS = 45_000;

/** Telegram webhook (production). Same handlers as `npm run tg:bot`. */
export async function POST(req: Request) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (secret) {
    const header = req.headers.get("x-telegram-bot-api-secret-token");
    if (header !== secret) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const update = (await req.json().catch(() => null)) as {
    update_id?: number;
    message?: Parameters<typeof handleTgMessage>[0];
    callback_query?: Parameters<typeof handleTgCallbackQuery>[0];
  } | null;
  if (!update) {
    return NextResponse.json({ error: "Bad body" }, { status: 400 });
  }

  try {
    await ensureTgBootstrap();
    if (update.callback_query) {
      await handleTgCallbackQuery(update.callback_query);
    }
    if (update.message) {
      await handleTgMessage(update.message);
    }
    await flushTgOutbox();

    const now = Date.now();
    if (now - lastLoraPollAt >= LORA_POLL_EVERY_MS) {
      lastLoraPollAt = now;
      void pollTgLoraTrainings().catch((e) =>
        console.error("[tg/webhook] lora poll", e),
      );
    }
  } catch (e) {
    console.error("[tg/webhook]", e);
  }

  return NextResponse.json({ ok: true });
}
