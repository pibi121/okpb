import { jsonOk, jsonErr, withOps } from "@/lib/ops/http";
import {
  ensureOpsTelegramTopics,
  pingOpsTelegramTopics,
  probeOpsTelegram,
} from "@/lib/ops/ops-telegram";
import { sendMarketingDigest } from "@/lib/ops/ops-telegram-digest";
import { writeAudit } from "@/lib/ops/audit";

export const runtime = "nodejs";

export async function GET() {
  return withOps("bot", async () => {
    const probe = await probeOpsTelegram();
    return jsonOk(probe);
  });
}

export async function POST(req: Request) {
  return withOps("bot", async (actor) => {
    const body = (await req.json()) as { action?: string };
    const action = body.action || "ping";

    if (action === "bootstrap") {
      const state = await ensureOpsTelegramTopics();
      const msg = await pingOpsTelegramTopics();
      await writeAudit({
        actorId: actor.id,
        action: "ops_tg_bootstrap",
        targetType: "opsTelegram",
        targetId: state.chatId,
        detail: { topics: state.topics, isForum: state.isForum },
      });
      return jsonOk({ ok: true, message: msg, topics: state.topics });
    }

    if (action === "ping") {
      const msg = await pingOpsTelegramTopics();
      return jsonOk({ ok: true, message: msg });
    }

    if (action === "digest") {
      const r = await sendMarketingDigest({
        from: new Date(Date.now() - 8 * 3600_000),
        to: new Date(),
        force: true,
      });
      return jsonOk({ ok: true, message: r.detail, key: r.key });
    }

    return jsonErr("action: bootstrap | ping | digest");
  });
}
