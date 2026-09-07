import { NextRequest, NextResponse } from "next/server";
import { listPendingPartnerWithdrawals } from "@/lib/tg/partner-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Future admin: list withdrawal requests. Auth = bootstrap secret. */
export async function GET(req: NextRequest) {
  if (process.env.BOOTSTRAP_ADMIN_ENABLED !== "1") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const expected =
    process.env.BOOTSTRAP_ADMIN_SECRET?.trim() ||
    process.env.AUTH_SECRET?.trim() ||
    "";
  const got = req.headers.get("x-bootstrap-secret")?.trim() || "";
  if (!expected || got !== expected) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const rows = await listPendingPartnerWithdrawals();
  return NextResponse.json({
    ok: true,
    pending: rows.map((w) => ({
      id: w.id,
      amountPeaches: w.amountPeaches,
      payoutDetails: w.payoutDetails,
      createdAt: w.createdAt.toISOString(),
      partnerCode: w.partner.code,
      userEmail: w.partner.user.email,
      userName: w.partner.user.name,
    })),
  });
}
