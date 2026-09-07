import { NextResponse } from "next/server";
import { resolveTgApiUserId } from "@/lib/tg/resolve-api-user";
import {
  createPartnerLink,
  getPartnerDashboard,
  partnerStartLink,
  requestPartnerWithdrawal,
} from "@/lib/tg/partner-program";

export async function GET(req: Request) {
  const userId = await resolveTgApiUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const dash = await getPartnerDashboard(userId);
  const links = dash.links.map((l) => ({
    id: l.id,
    slug: l.slug,
    label: l.label,
    clicks: l.clicks,
    signups: l.signups,
    purchases: l.purchases ?? 0,
    purchaseGrossPeaches: l.purchaseGrossPeaches ?? 0,
    commissionPeaches: l.commissionPeaches ?? 0,
    url: partnerStartLink(
      dash.botUsername,
      dash.profile.code,
      l.slug === "main" ? undefined : l.slug,
    ),
  }));

  return NextResponse.json({
    balancePeaches: dash.profile.balancePeaches,
    totalEarnedPeaches: dash.profile.totalEarnedPeaches,
    commissionPct: dash.profile.commissionPct,
    code: dash.profile.code,
    referrals: dash.referrals,
    purchases: dash.purchases ?? 0,
    purchaseGrossPeaches: dash.purchaseGrossPeaches ?? 0,
    commissionPeaches: dash.commissionPeaches ?? dash.profile.totalEarnedPeaches,
    links,
    mainUrl: partnerStartLink(dash.botUsername, dash.profile.code),
    commissions: dash.commissions.map((c) => ({
      id: c.id,
      amountPeaches: c.amountPeaches,
      grossPeaches: c.grossPeaches,
      kind: c.kind,
      createdAt: c.createdAt.toISOString(),
    })),
    withdrawals: dash.withdrawals.map((w) => ({
      id: w.id,
      amountPeaches: w.amountPeaches,
      status: w.status,
      payoutDetails: w.payoutDetails,
      createdAt: w.createdAt.toISOString(),
    })),
  });
}

export async function POST(req: Request) {
  const userId = await resolveTgApiUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json()) as {
    action?: string;
    label?: string;
    slug?: string;
    amountPeaches?: number;
    payoutDetails?: string;
  };

  try {
    if (body.action === "create_link") {
      const link = await createPartnerLink(userId, body.label || "Ссылка", body.slug);
      const dash = await getPartnerDashboard(userId);
      return NextResponse.json({
        link: {
          id: link.id,
          slug: link.slug,
          label: link.label,
          url: partnerStartLink(
            dash.botUsername,
            dash.profile.code,
            link.slug === "main" ? undefined : link.slug,
          ),
        },
      });
    }
    if (body.action === "withdraw") {
      const w = await requestPartnerWithdrawal({
        userId,
        amountPeaches: Number(body.amountPeaches) || 0,
        payoutDetails: body.payoutDetails || "",
      });
      return NextResponse.json({
        withdrawal: {
          id: w.id,
          amountPeaches: w.amountPeaches,
          status: w.status,
        },
      });
    }
    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
