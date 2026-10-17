import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { purchasePeachPhotoTemplate } from "@/lib/peach-photo-template";
import { maintenanceApiBlock } from "@/lib/ops/maintenance-api";

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const maintenanceBlock = await maintenanceApiBlock();
  if (maintenanceBlock) return maintenanceBlock;

  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });
  const { id } = await ctx.params;
  try {
    const template = await purchasePeachPhotoTemplate(user.id, id);
    return NextResponse.json({ template });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
