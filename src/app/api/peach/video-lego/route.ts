import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { requireUser } from "@/lib/auth";
import type { VideoLegoFile } from "@/lib/prompt-lego-core";

const FILE = path.join(process.cwd(), "presets", "prompt_lego_video.json");

export async function GET() {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });
  if (!fs.existsSync(FILE)) {
    return NextResponse.json({ error: "prompt_lego_video.json not found" }, { status: 404 });
  }
  const data = JSON.parse(fs.readFileSync(FILE, "utf8")) as VideoLegoFile;
  return NextResponse.json({ catalog: data });
}

export async function PUT(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });
  const body = (await req.json()) as { catalog?: VideoLegoFile };
  if (!body.catalog) {
    return NextResponse.json({ error: "catalog required" }, { status: 400 });
  }
  fs.writeFileSync(FILE, `${JSON.stringify(body.catalog, null, 2)}\n`, "utf8");
  return NextResponse.json({ ok: true });
}
