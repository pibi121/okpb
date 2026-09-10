import { jsonOk, withOps } from "@/lib/ops/http";
import { getOpsSettings, saveOpsSettings } from "@/lib/ops/settings";
import { writeAudit } from "@/lib/ops/audit";
import { parseAgeGateConfig } from "@/lib/age-gate";

export async function GET() {
  return withOps("settings", async () => {
    const s = await getOpsSettings();
    const cfg = parseAgeGateConfig(s.ageGateJson, s.ageGateEnabled);
    return jsonOk({
      ageGateEnabled: cfg.enabled,
      blockBuckets: cfg.blockBuckets,
      faceThresh: cfg.faceThresh,
      minScore: cfg.minScore,
      failClosed: cfg.failClosed,
      note:
        "Проверка возраста на Railway (CPU). По умолчанию блокирует только явные детские бакеты (0-12). Metalnode не трогает.",
    });
  });
}

export async function POST(req: Request) {
  return withOps("settings", async (actor) => {
    const body = (await req.json()) as {
      ageGateEnabled?: boolean;
      blockBuckets?: string;
      faceThresh?: number;
      minScore?: number;
      failClosed?: boolean;
    };
    const s = await getOpsSettings();
    const prev = parseAgeGateConfig(s.ageGateJson, s.ageGateEnabled);
    const enabled =
      typeof body.ageGateEnabled === "boolean" ? body.ageGateEnabled : prev.enabled;
    const nextJson = {
      blockBuckets:
        typeof body.blockBuckets === "string" && body.blockBuckets.trim()
          ? body.blockBuckets.trim()
          : prev.blockBuckets,
      faceThresh:
        typeof body.faceThresh === "number" && body.faceThresh > 0
          ? body.faceThresh
          : prev.faceThresh,
      minScore:
        typeof body.minScore === "number" && body.minScore > 0
          ? body.minScore
          : prev.minScore,
      failClosed:
        typeof body.failClosed === "boolean" ? body.failClosed : prev.failClosed,
    };
    await saveOpsSettings({
      ageGateEnabled: enabled,
      ageGateJson: JSON.stringify(nextJson),
    });
    await writeAudit({
      actorId: actor.id,
      action: "safety_age_gate",
      targetType: "opsSetting",
      targetId: "main",
      detail: { ageGateEnabled: enabled, ...nextJson },
    });
    return jsonOk({ ok: true, ageGateEnabled: enabled, ...nextJson });
  });
}
