/**
 * PeachBitch Telegram bot — long-polling (supports dual-bot).
 * Usage: TELEGRAM_BOT_TOKEN=... npm run tg:bot
 *
 * Polls every active BotInstance token in parallel. Primary env token always included.
 */
import "dotenv/config";
import { handleTgMessage, handleTgCallbackQuery, flushTgOutbox } from "../src/lib/tg/bot-update";
import { pollTgLoraTrainings } from "../src/lib/tg/lora-train-poller";
import { pollTgFunnelDrips } from "../src/lib/tg/funnel-drip";
import { tgApiWithToken } from "../src/lib/tg/telegram-api";
import { bootOps } from "../src/lib/ops/seed";
import { ensureCopyOverlay } from "../src/lib/ops/copy";
import { listLiveBots, listPollableBots, type LiveBot } from "../src/lib/tg/bot-registry";
import { runWithTgBot } from "../src/lib/tg/bot-context";

type TgUpdate = {
  update_id: number;
  message?: Parameters<typeof handleTgMessage>[0];
  callback_query?: Parameters<typeof handleTgCallbackQuery>[0];
};

/** Prefer dual-bot poller; fall back if registry build is older. */
async function loadPollableBots(): Promise<LiveBot[]> {
  if (typeof listPollableBots === "function") {
    return listPollableBots();
  }
  console.warn("[tg-bot] listPollableBots missing — using listLiveBots");
  return listLiveBots();
}

async function pollOneBot(bot: LiveBot) {
  let offset = 0;
  console.log(
    `[tg-bot] polling @${bot.username} primary=${bot.isPrimary} status=${bot.status}…`,
  );

  for (;;) {
    try {
      const updates = await tgApiWithToken<TgUpdate[]>(bot.token, "getUpdates", {
        offset,
        timeout: 25,
        allowed_updates: ["message", "callback_query"],
      });
      for (const u of updates) {
        offset = u.update_id + 1;
        await runWithTgBot(
          {
            botInstanceId: bot.id,
            username: bot.username,
            token: bot.token,
            telegramBotId: bot.telegramBotId,
          },
          async () => {
            if (u.callback_query) {
              try {
                await handleTgCallbackQuery(u.callback_query);
              } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                const { isDeadTelegramRecipient, reportOpsError } = await import(
                  "../src/lib/ops/errors"
                );
                if (isDeadTelegramRecipient(msg)) {
                  console.warn(
                    `[tg-bot @${bot.username}] callback skipped (blocked/gone):`,
                    msg,
                  );
                } else {
                  console.error(`[tg-bot @${bot.username}] callback error:`, e);
                  void reportOpsError({
                    kind: "bot",
                    message: msg,
                    stack: e instanceof Error ? e.stack : undefined,
                    stage: "poll_callback",
                    meta: { bot: bot.username },
                  }).catch(() => undefined);
                }
              }
            }
            if (u.message) {
              try {
                await handleTgMessage(u.message);
              } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                const { isDeadTelegramRecipient, reportOpsError } = await import(
                  "../src/lib/ops/errors"
                );
                if (isDeadTelegramRecipient(msg)) {
                  console.warn(
                    `[tg-bot @${bot.username}] message skipped (blocked/gone):`,
                    msg,
                  );
                } else {
                  console.error(`[tg-bot @${bot.username}] message error:`, e);
                  void reportOpsError({
                    kind: "bot",
                    message: msg,
                    stack: e instanceof Error ? e.stack : undefined,
                    stage: "poll_message",
                    meta: { bot: bot.username },
                  }).catch(() => undefined);
                }
              }
            }
          },
        );
      }
      await flushTgOutbox();
    } catch (e) {
      console.error(`[tg-bot @${bot.username}]`, e);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

async function main() {
  console.log("[tg-bot] starting dual-capable poller…");
  await bootOps().catch((e) => console.error("[tg-bot] bootOps", e));
  await ensureCopyOverlay().catch((e) => console.error("[tg-bot] copy", e));

  setInterval(() => {
    void flushTgOutbox().catch((e) => console.error("[tg-outbox]", e));
    void pollTgLoraTrainings().catch((e) => console.error("[tg-lora-poll]", e));
    void pollTgFunnelDrips().catch((e) => console.error("[tg-funnel-poll]", e));
    void ensureCopyOverlay().catch(() => undefined);
    void import("../src/lib/ops/prices")
      .then(({ ensurePriceOverlay }) => ensurePriceOverlay())
      .catch(() => undefined);
  }, 2000);

  let bots = await loadPollableBots();
  if (!bots.length) {
    console.error("No live bots — set TELEGRAM_BOT_TOKEN or add dual bot in /ops/bot");
    process.exit(1);
  }

  // Refresh bot list periodically so admin-added dual bots start without full redeploy
  // of the whole Railway box — only this poller process needs to pick them up.
  setInterval(() => {
    void loadPollableBots()
      .then((next) => {
        const known = new Set(bots.map((b) => b.token));
        for (const b of next) {
          if (known.has(b.token)) continue;
          console.log(
            `[tg-bot] hot-add @${b.username} status=${b.status}`,
          );
          bots = next;
          void pollOneBot(b);
        }
        bots = next;
      })
      .catch((e) => console.error("[tg-bot] refresh bots", e));
  }, 15_000);

  await Promise.all(bots.map((b) => pollOneBot(b)));
}

void main();
