import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { listSocialRuns } from "@/lib/social-ref2v";
import { maintenanceApiBlock } from "@/lib/ops/maintenance-api";

export const runtime = "nodejs";

/** @deprecated Use /api/peach/social/runs */
export async function GET() {
  const maintenanceBlock = await maintenanceApiBlock();
  if (maintenanceBlock) return maintenanceBlock;

  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });
  const runs = await listSocialRuns(user.id);
  return NextResponse.json({ runs, deprecated: true });
}

export async function POST() {
  const maintenanceBlock = await maintenanceApiBlock();
  if (maintenanceBlock) return maintenanceBlock;

  return NextResponse.json(
    {
      error:
        "Старый Ref2V upload отключён. Используй /peach/social — шаблон + модель.",
    },
    { status: 410 },
  );
}
