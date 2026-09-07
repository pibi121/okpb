import { NextResponse } from "next/server";
import { requireOps } from "@/lib/ops/auth";
import type { OpsActor } from "@/lib/ops/auth";
import type { OpsSection } from "@/lib/ops/roles";

export function jsonOk(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

export function jsonErr(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function withOps(
  section: OpsSection,
  handler: (actor: OpsActor) => Promise<NextResponse>,
) {
  const actor = await requireOps(section);
  if (!actor) return jsonErr("Нет доступа", 401);
  try {
    return await handler(actor);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "ошибка";
    return jsonErr(msg, 400);
  }
}
