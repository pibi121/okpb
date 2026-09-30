/**
 * Long-poll for the separate staff ops bot (OPS_TG_BOT_TOKEN) so inline buttons
 * in the ops chat (Age Gate approve/reject) work. The product bots are polled
 * elsewhere; if the ops token IS a product bot token, this stays off (its
 * callbacks already reach handleTgCallbackQuery).
 *
 * Runs only on Railway (or OPS_TG_CALLBACK_POLL=1). OPS_TG_CALLBACK_POLL=0 disables.
 */
import { tgApiWithToken } from "@/lib/tg/telegram-api";

type Update = {
  update_id: number;
  callback_query?: Parameters<
    typeof import("@/lib/age-gate-review").handleOpsModerationCallback
  >[0];
};

const g = globalThis as { __opsCbPollerStarted?: boolean };

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

export function startOpsCallbackPoller(): void {
  if (g.__opsCbPollerStarted) return;
  const flag = process.env.OPS_TG_CALLBACK_POLL;
  if (flag === "0") return;
  if (flag !== "1" && !process.env.RAILWAY_ENVIRONMENT) return;
  g.__opsCbPollerStarted = true;
  void run().catch((e) => {
    g.__opsCbPollerStarted = false;
    console.error("[ops-tg-poll] stopped:", e);
  });
}

async function run(): Promise<void> {
  const { opsTelegramToken, opsTelegramChatId } = await import(
    "@/lib/ops/ops-telegram"
  );
  const token = opsTelegramToken();
  if (!token || !opsTelegramChatId()) return;

  // Same token as a product bot → its own poller already delivers callbacks.
  if (process.env.TELEGRAM_BOT_TOKEN?.trim() === token) return;
  try {
    const { listPollableBots } = await import("@/lib/tg/bot-registry");
    const bots = await listPollableBots();
    if (bots.some((b) => b.token === token)) return;
  } catch {
    /* registry unavailable → assume separate ops bot */
  }

  const { handleOpsModerationCallback } = await import(
    "@/lib/age-gate-review"
  );
  console.log("[ops-tg-poll] started (separate ops bot)");

  let offset = 0;
  let failStreak = 0;
  while (true) {
    try {
      const updates = await tgApiWithToken<Update[]>(token, "getUpdates", {
        offset,
        timeout: 25,
        allowed_updates: ["callback_query"],
      });
      failStreak = 0;
      for (const u of updates) {
        offset = Math.max(offset, u.update_id + 1);
        if (u.callback_query) {
          await handleOpsModerationCallback(u.callback_query, token).catch(
            (e) => console.error("[ops-tg-poll] callback:", e),
          );
        }
      }
    } catch (e) {
      failStreak += 1;
      if (failStreak === 1 || failStreak % 20 === 0) {
        console.warn(
          "[ops-tg-poll] getUpdates:",
          e instanceof Error ? e.message : e,
        );
      }
      await sleep(Math.min(60_000, 3_000 * failStreak));
    }
  }
}
