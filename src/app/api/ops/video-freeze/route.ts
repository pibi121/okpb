import { jsonErr, jsonOk, withOps } from "@/lib/ops/http";
import { writeAudit } from "@/lib/ops/audit";
import { getOpsSettings } from "@/lib/ops/settings";
import {
  disableVideoFreeze,
  enableVideoFreeze,
  VIDEO_FREEZE_BACK_BROADCAST,
  VIDEO_FREEZE_BROADCAST,
} from "@/lib/ops/video-freeze";

export async function GET() {
  return withOps("settings", async () => {
    const settings = await getOpsSettings();
    return jsonOk({
      videoFrozen: settings.videoFrozen,
      enableText: VIDEO_FREEZE_BROADCAST,
      disableText: VIDEO_FREEZE_BACK_BROADCAST,
    });
  });
}

export async function POST(req: Request) {
  return withOps("settings", async (actor) => {
    const body = (await req.json()) as { action?: string };
    if (body.action === "on") {
      const result = await enableVideoFreeze(actor.id);
      await writeAudit({
        actorId: actor.id,
        action: "video_freeze_on",
        targetType: "opsSetting",
        targetId: "main",
        detail: result,
      });
      return jsonOk(result);
    }
    if (body.action === "off") {
      const result = await disableVideoFreeze(actor.id);
      await writeAudit({
        actorId: actor.id,
        action: "video_freeze_off",
        targetType: "opsSetting",
        targetId: "main",
        detail: result,
      });
      return jsonOk(result);
    }
    return jsonErr("Неизвестное действие");
  });
}
