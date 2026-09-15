import { NextResponse } from "next/server";
import {
  handleTgMessage,
  handleTgCallbackQuery,
  flushTgOutbox,
} from "@/lib/tg/bot-update";
import { ensureTgBootstrap } from "@/lib/tg/tg-bootstrap";
import { pollTgLoraTrainings } from "@/lib/tg/lora-train-poller";
import { pollTgFunnelDrips } from "@/lib/tg/funnel-drip";

/** Throttle LoRA completion polls — webhook traffic is frequent. */
let lastLoraPollAt = 0;
const LORA_POLL_EVERY_MS = 45_000;
let lastFunnelPollAt = 0;
const FUNNEL_POLL_EVERY_MS = 30_000;

/** Telegram webhook (production). Same handlers as `npm run tg:bot`.
 *
 * NOTE: This route is available but the production bot currently uses long polling
 * (tg-bot-dev.ts). If you switch to webhook mode, set TELEGRAM_WEBHOOK_SECRET and
 * register the webhook URL with Telegram. The secret check below will then activate.
 */
export async function POST(req: Request) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (secret) {
    // Secret is configured — enforce it. Without the correct header Telegram
    // (and any attacker) gets a 403, not a 200.
    const header = req.headers.get("x-telegram-bot-api-secret-token");
    if (header !== secret) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  } else {
    // No secret configured: block all webhook calls entirely so the endpoint
    // can't be abused while polling mode is active.
    return NextResponse.json({ error: "Webhook not configured" }, { status: 403 });
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
    if (now - lastFunnelPollAt >= FUNNEL_POLL_EVERY_MS) {
      lastFunnelPollAt = now;
      void pollTgFunnelDrips().catch((e) =>
        console.error("[tg/webhook] funnel poll", e),
      );
    }
  } catch (e) {
    console.error("[tg/webhook]", e);
    void import("@/lib/ops/errors")
      .then(({ reportOpsError }) =>
        reportOpsError({
          kind: "bot",
          message: e instanceof Error ? e.message : String(e),
          stack: e instanceof Error ? e.stack : undefined,
          stage: "webhook",
        }),
      )
      .catch(() => undefined);
  }

  return NextResponse.json({ ok: true });
}
