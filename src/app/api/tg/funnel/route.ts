import { NextResponse } from "next/server";
import { resolveTgApiUserId } from "@/lib/tg/resolve-api-user";
import { trackFunnelEvent } from "@/lib/ops/funnel-track";
import { getFunnelStep } from "@/lib/ops/funnel-catalog";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const userId = await resolveTgApiUserId(req);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    eventKey?: string;
    meta?: Record<string, unknown>;
    path?: string;
  };

  const eventKey = (body.eventKey || "").trim();
  if (!eventKey) {
    return NextResponse.json({ error: "eventKey required" }, { status: 400 });
  }

  // Only allow known miniapp/system keys or namespaced custom miniapp.action
  const step = getFunnelStep(eventKey);
  if (
    step.surface !== "miniapp" &&
    !eventKey.startsWith("miniapp.") &&
    eventKey !== "miniapp.action"
  ) {
    return NextResponse.json({ error: "invalid event" }, { status: 400 });
  }

  await trackFunnelEvent({
    userId,
    eventKey,
    surface: "miniapp",
    meta: {
      ...(body.meta || {}),
      ...(body.path ? { path: body.path } : {}),
    },
  });

  return NextResponse.json({ ok: true });
}
