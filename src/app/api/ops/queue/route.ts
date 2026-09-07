import { jsonOk, withOps } from "@/lib/ops/http";
import { collectQueueDetails, probeGpuHealth } from "@/lib/ops/stats";
import { saveOpsSettings } from "@/lib/ops/settings";
import { writeAudit } from "@/lib/ops/audit";
import { jsonErr } from "@/lib/ops/http";

export async function GET() {
  return withOps("queue", async () => {
    const [queue, gpu] = await Promise.all([collectQueueDetails(), probeGpuHealth()]);
    return jsonOk({ queue, gpu });
  });
}

export async function POST(req: Request) {
  return withOps("settings", async (actor) => {
    const body = (await req.json()) as {
      maintenance?: boolean;
      loadMode?: boolean;
      maintenanceMessageRu?: string;
      maintenanceMessageEn?: string;
      loadMessageRu?: string;
      loadMessageEn?: string;
    };
    const settings = await saveOpsSettings(body);
    await writeAudit({
      actorId: actor.id,
      action: "ops_settings",
      targetType: "opsSetting",
      targetId: "main",
      detail: {
        maintenance: settings.maintenance,
        loadMode: settings.loadMode,
      },
    });
    return jsonOk({ settings });
  });
}
