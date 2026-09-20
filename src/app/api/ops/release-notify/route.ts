import { NextResponse } from "next/server";
import { notifyOpsRelease } from "@/lib/ops/ops-telegram";
import { resolveReleaseMeta } from "@/lib/ops/release-meta";

export const runtime = "nodejs";

/**
 * CI / local script hook for ops «Деплои» notifications.
 * Auth: Authorization: Bearer $OPS_RELEASE_NOTIFY_SECRET
 */
export async function POST(req: Request) {
  const secret = process.env.OPS_RELEASE_NOTIFY_SECRET?.trim();
  if (!secret) {
    return NextResponse.json(
      { error: "OPS_RELEASE_NOTIFY_SECRET not set" },
      { status: 503 },
    );
  }
  const auth = req.headers.get("authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (token !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    kind?: "commit" | "deploy";
    sha?: string;
    message?: string;
    buildVersion?: string;
    branch?: string;
    at?: string;
    force?: boolean;
  };

  const meta = resolveReleaseMeta();
  const kind = body.kind === "deploy" ? "deploy" : "commit";
  const r = await notifyOpsRelease({
    kind,
    sha: (body.sha || meta.sha || "").trim(),
    message: (body.message || meta.message || "").trim(),
    buildVersion: body.buildVersion || meta.buildVersion,
    branch: body.branch || meta.branch,
    at: body.at || meta.at,
    force: Boolean(body.force),
  });

  return NextResponse.json({ ok: r.sent, detail: r.detail, kind });
}
