import { jsonOk, withOps } from "@/lib/ops/http";
import { getOpsSettings, saveOpsSettings } from "@/lib/ops/settings";
import { writeAudit } from "@/lib/ops/audit";
import {
  applyAgeGatePatch,
  parseAgeGateConfig,
  publicAgeGateConfig,
  serializeAgeGateConfig,
} from "@/lib/age-gate";
import { AGE_API_MODELS, checkAgeApiKey } from "@/lib/age-gate-api";
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
              ageYears: gate.ageYears ?? null,
              score: gate.score ?? null,
              secondLabel: gate.secondLabel ?? null,
              secondScore: gate.secondScore ?? null,
              faces: gate.faces ?? null,
              engine: gate.engine ?? null,
              apiModel: gate.apiModel ?? null,
              apiAgeMin: gate.apiAgeMin ?? null,
              apiAgeMax: gate.apiAgeMax ?? null,
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
    // publicAgeGateConfig: the API key is replaced by a mask — never returned.
    const pub = publicAgeGateConfig(cfg);
    return jsonOk({
      ageGateEnabled: pub.enabled,
      engine: pub.engine,
      blockBuckets: pub.blockBuckets,
      faceThresh: pub.faceThresh,
      minScore: pub.minScore,
      minAdultScore: pub.minAdultScore,
      manualUncertainModeration: pub.manualUncertainModeration,
      failClosed: pub.failClosed,
      apiKeySet: pub.apiKeySet,
      apiKeyMasked: pub.apiKeyMasked,
      apiModel: pub.apiModel,
      apiPassAge: pub.apiPassAge,
      apiFallbackLocal: pub.apiFallbackLocal,
      apiFallbackEngine: pub.apiFallbackEngine,
      notifyAll: pub.notifyAll,
      notifyApproved: pub.notifyApproved,
      notifyRejected: pub.notifyRejected,
      apiModels: [...AGE_API_MODELS],
      pendingCount,
      note:
        "Age-gate только для Telegram (онбординг/гены). Лаборатория Peach (/api/characters, /api/peach) не проверяется. Metalnode не трогает.",
    });
  });
}

export async function POST(req: Request) {
  return withOps("settings", async (actor) => {
    const body = (await req.json()) as Record<string, unknown> & {
      action?: "approve" | "reject" | "check_key";
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

    if (body.action === "check_key") {
      // Typed-but-unsaved key is checked as is; otherwise the stored one.
      const s0 = await getOpsSettings();
      const stored = parseAgeGateConfig(s0.ageGateJson, s0.ageGateEnabled);
      const typed = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
      const check = await checkAgeApiKey(typed || stored.apiKey);
      return jsonOk({
        ok: check.ok,
        status: check.status ?? null,
        balance: check.balance ?? null,
        budget: check.budget ?? null,
        error: check.error ?? null,
      });
    }

    const s = await getOpsSettings();
    const prev = parseAgeGateConfig(s.ageGateJson, s.ageGateEnabled);
    const next = applyAgeGatePatch(prev, body);
    await saveOpsSettings({
      ageGateEnabled: next.enabled,
      ageGateJson: serializeAgeGateConfig(next),
    });
    const pub = publicAgeGateConfig(next);
    await writeAudit({
      actorId: actor.id,
      action: "safety_age_gate",
      targetType: "opsSetting",
      targetId: "main",
      // pub has no apiKey (mask + flag only) — key must never reach the audit log.
      detail: {
        ...pub,
        apiKeyChanged: next.apiKey !== prev.apiKey,
      },
    });
    return jsonOk({ ok: true, ...pub });
  });
}
