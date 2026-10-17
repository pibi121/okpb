import { NextResponse } from "next/server";
import { maintenanceStubText } from "@/lib/ops/maintenance-stub";

/** 503 for Mini App and studio writes/reads while maintenance is on. */
export async function maintenanceApiBlock() {
  const text = await maintenanceStubText();
  if (!text) return null;
  return NextResponse.json({ error: text, maintenance: true }, { status: 503 });
}
