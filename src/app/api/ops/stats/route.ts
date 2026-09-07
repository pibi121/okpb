import { jsonOk } from "@/lib/ops/http";
import { withOps } from "@/lib/ops/http";
import { collectOpsStats, probeBotHealth, probeGpuHealth } from "@/lib/ops/stats";
import { getActiveBotUrl } from "@/lib/tg/bot-config";
import { getOpsSettings } from "@/lib/ops/settings";

export async function GET() {
  return withOps("dashboard", async () => {
    const [stats, bot, gpu, botUrl, settings] = await Promise.all([
      collectOpsStats(),
      probeBotHealth(),
      probeGpuHealth(),
      getActiveBotUrl(),
      getOpsSettings(),
    ]);
    return jsonOk({ stats, bot, gpu, botUrl, settings });
  });
}
