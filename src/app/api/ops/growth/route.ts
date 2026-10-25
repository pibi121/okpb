import { jsonErr, jsonOk } from "@/lib/ops/http";
import { requireOps } from "@/lib/ops/auth";
import {
  collectGrowthPlan,
  saveGrowthSettings,
  type GrowthSettings,
} from "@/lib/ops/growth-plan";

export const runtime = "nodejs";

async function staff() {
  const actor = await requireOps();
  if (!actor || actor.adminRole === "partner") return null;
  return actor;
}

function num(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  return v;
}

export async function GET(req: Request) {
  if (!(await staff())) return jsonErr("Нет доступа", 401);
  const url = new URL(req.url);
  try {
    const data = await collectGrowthPlan(
      url.searchParams.get("from") || "",
      url.searchParams.get("to") || "",
    );
    return jsonOk(data);
  } catch (e) {
    return jsonErr(e instanceof Error ? e.message : "ошибка");
  }
}

export async function PATCH(req: Request) {
  if (!(await staff())) return jsonErr("Нет доступа", 401);
  const url = new URL(req.url);
  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return jsonErr("Нужен JSON");
  }
  const patch: Partial<GrowthSettings> = {};
  if ("monthlyNetGoalRub" in body) {
    const n = num(body.monthlyNetGoalRub);
    if (n == null || n < 0) return jsonErr("Цель — число от нуля");
    patch.monthlyNetGoalRub = n;
  }
  if ("paymentFeePct" in body) {
    const n = num(body.paymentFeePct);
    if (n == null || n < 0 || n > 80) return jsonErr("Комиссия платёжки — от 0 до 80%");
    patch.paymentFeePct = n;
  }
  if ("gpuDailyRub" in body) {
    const n = num(body.gpuDailyRub);
    if (n == null || n < 0) return jsonErr("Карты в день — число от нуля");
    patch.gpuDailyRub = n;
  }
  if ("excludedPartnerIds" in body) {
    if (!Array.isArray(body.excludedPartnerIds)) return jsonErr("Список партнёров битый");
    patch.excludedPartnerIds = body.excludedPartnerIds.filter(
      (id): id is string => typeof id === "string",
    );
  }
  try {
    await saveGrowthSettings(patch);
    const data = await collectGrowthPlan(
      url.searchParams.get("from") || "",
      url.searchParams.get("to") || "",
    );
    return jsonOk(data);
  } catch (e) {
    return jsonErr(e instanceof Error ? e.message : "ошибка");
  }
}
