import { NextResponse } from "next/server";
import { runTgBootstrapNow } from "@/lib/tg/tg-bootstrap";

function authorized(req: Request): boolean {
  const secret = process.env.TG_BOOTSTRAP_SECRET?.trim();
  if (!secret) return process.env.NODE_ENV !== "production";
  const header = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const q = new URL(req.url).searchParams.get("secret");
  return header === secret || q === secret;
}

/** Manual / deploy-time TG catalog seed (studio casts + templates). */
export async function POST(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const counts = await runTgBootstrapNow();
  return NextResponse.json({ ok: true, ...counts });
}

/** GET also seeds (for easy curl after deploy). */
export async function GET(req: Request) {
  return POST(req);
}
