/**
 * One-shot silent Funnel v2 go-live (ops / deploy).
 * POST { "confirm": true } — freezes pre_funnel_v2 broadcast cutoff.
 */
import { jsonOk, jsonErr, withOps } from "@/lib/ops/http";
import { setFunnelV2Live, isFunnelV2Live } from "@/lib/tg/funnel-v2/mode";
import { getOpsSettings } from "@/lib/ops/settings";
import { writeAudit } from "@/lib/ops/audit";
import { previewBroadcastAudience } from "@/lib/ops/broadcast";

export async function GET() {
  return withOps("settings", async () => {
    const s = await getOpsSettings();
    const preCount = await previewBroadcastAudience(
      JSON.stringify({ who: "pre_funnel_v2" }),
    );
    return jsonOk({
      live: await isFunnelV2Live(),
      liveAt: s.tgFunnelV2LiveAt,
      preFunnelAudience: preCount,
    });
  });
}

export async function POST(req: Request) {
  return withOps("settings", async (actor) => {
    const body = (await req.json().catch(() => ({}))) as {
      confirm?: boolean;
      live?: boolean;
    };
    if (!body.confirm) {
      return jsonErr("Передай { confirm: true }", 400);
    }
    const live = body.live !== false;
    await setFunnelV2Live(live);
    const s = await getOpsSettings();
    const preCount = await previewBroadcastAudience(
      JSON.stringify({ who: "pre_funnel_v2" }),
    );
    await writeAudit({
      actorId: actor.id,
      action: live ? "funnel_v2_go_live" : "funnel_v2_go_offline",
      detail: { liveAt: s.tgFunnelV2LiveAt, preFunnelAudience: preCount },
    });
    return jsonOk({
      live: await isFunnelV2Live(),
      liveAt: s.tgFunnelV2LiveAt,
      preFunnelAudience: preCount,
    });
  });
}
