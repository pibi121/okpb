import { NextResponse } from "next/server";
import { listDefaultAvatarUrls } from "@/lib/default-avatars";
import { maintenanceApiBlock } from "@/lib/ops/maintenance-api";

export async function GET() {
  const maintenanceBlock = await maintenanceApiBlock();
  if (maintenanceBlock) return maintenanceBlock;

  return NextResponse.json({ avatars: listDefaultAvatarUrls() });
}
