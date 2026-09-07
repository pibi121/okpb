import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { comfyBaseUrl } from "@/lib/metalnode-config";
import { BUILD_VERSION } from "@/lib/gpu/types";

async function pingComfy(): Promise<boolean> {
  try {
    const res = await fetch(`${comfyBaseUrl()}/system_stats`, {
      signal: AbortSignal.timeout(4000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Quick prod deploy check — curl /api/tg/version after Railway deploy. */
export async function GET() {
  // Scrub author identity from stored templates (lookbook/LoRA leakage).
  void import("@/lib/tg/migrate-template-identity")
    .then((m) => m.migrateTemplateIdentityHygiene())
    .catch((e) => console.error("[peach] template migrate on version:", e));
  // Scrub leaked reference stills from video template public thumbs.
  void import("@/lib/tg/migrate-video-preview")
    .then((m) => m.migrateVideoTemplatePreviewHygiene())
    .catch((e) => console.error("[peach] video preview migrate on version:", e));

  const catalogDir = path.join(process.cwd(), "public", "tg", "catalog");
  const catalogOk = fs.existsSync(catalogDir);

  const comfyUp = await pingComfy();

  return NextResponse.json({
    ok: true,
    build: BUILD_VERSION,
    gpu: { up: comfyUp },
    catalog: catalogOk,
  });
}
