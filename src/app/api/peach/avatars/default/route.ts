import { NextResponse } from "next/server";
import { listDefaultAvatarUrls } from "@/lib/default-avatars";

export async function GET() {
  return NextResponse.json({ avatars: listDefaultAvatarUrls() });
}
