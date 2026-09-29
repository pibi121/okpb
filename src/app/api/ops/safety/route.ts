import { jsonOk, withOps } from "@/lib/ops/http";
import { getOpsSettings, saveOpsSettings } from "@/lib/ops/settings";
import { writeAudit } from "@/lib/ops/audit";
import { parseAgeGateConfig } from "@/lib/age-gate";
import { prisma } from "@/lib/db";
import { resolveAgeGateReview } from "@/lib/age-gate-review";

export async function GET(req: Request) {
  return withOps("settings", async () => {
    const url = new URL(req.url);
    const list = url.searchParams.get("list");

    if (list === "pending") {
      const rows = await prisma.ageGateReview.findMany({
        where: { status: "pending" },
        orderBy: { createdAt: "asc" },
        take: 100,
      });
      return jsonOk({
        pending: rows.map((r) => {
          let gate: Record<string, unknown> = {};
          try {
            gate = JSON.parse(r.gateJson || "{}") as Record<string, unknown>;
          } catch {
            gate = {};
          }
          return {
            id: r.id,
            userId: r.userId,
            platformUserId: r.platformUserId,
            chatId: r.chatId,
            locale: r.locale,
            photoUrl: r.photoUrl,
            photoRelKey: r.photoRelKey,
            photoHash: r.photoHash,
            createdAt: r.createdAt.toISOString(),
            gateSummary: {
              reason: gate.reason ?? null,
              ageLabel: gate.ageLabel ?? null,
              score: gate.score ?? null,
              secondLabel: gate.secondLabel ?? null,
              secondScore: gate.secondScore ?? null,
              faces: gate.faces ?? null,
            },
          };
        }),
      });
    }

    const s = await getOpsSettings();
    const cfg = parseAgeGateConfig(s.ageGateJson, s.ageGateEnabled);
    const pendingCount = await prisma.ageGateReview.count({
      where: { status: "pending" },
    });
    return jsonOk({
      ageGateEnabled: cfg.enabled,
      blockBuckets: cfg.blockBuckets,
      faceThresh: cfg.faceThresh,
      minScore: cfg.minScore,
      minAdultScore: cfg.minAdultScore,
      manualUncertainModeration: cfg.manualUncertainModeration,
      failClosed: cfg.failClosed,
      pendingCount,
      note:
        "Age-gate только для Telegram (онбординг/гены). Лаборатория Peach (/api/characters, /api/peach) не проверяется. Metalnode не трогает.",
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
      minAdultScore?: number;
      manualUncertainModeration?: boolean;
      failClosed?: boolean;
      action?: "approve" | "reject";
      id?: string;
    };

    if (body.action === "approve" || body.action === "reject") {
      const id = String(body.id || "").trim();
      if (!id) throw new Error("id required");
      const result = await resolveAgeGateReview({
        id,
        decision: body.action === "approve" ? "approved" : "rejected",
        opsUserId: actor.id,
      });
      await writeAudit({
        actorId: actor.id,
        action: `safety_age_gate_${body.action}`,
        targetType: "ageGateReview",
        targetId: id,
        detail: { status: result.status, userId: result.userId },
      });
      return jsonOk({ ...result });
    }

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
      minAdultScore:
        typeof body.minAdultScore === "number" && body.minAdultScore > 0
          ? body.minAdultScore
          : prev.minAdultScore,
      manualUncertainModeration:
        typeof body.manualUncertainModeration === "boolean"
          ? body.manualUncertainModeration
          : prev.manualUncertainModeration,
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
