import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import {
  createPartnerLink,
  getPartnerDashboard,
  partnerStartLink,
  requestPartnerWithdrawal,
} from "@/lib/tg/partner-program";

export async function GET() {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });
  const dash = await getPartnerDashboard(user.id);
  const links = dash.links.map((l) => ({
    ...l,
    url: partnerStartLink(dash.botUsername, dash.profile.code, l.slug === "main" ? undefined : l.slug),
  }));
  return NextResponse.json({
    profile: dash.profile,
    referrals: dash.referrals,
    commissions: dash.commissions,
    withdrawals: dash.withdrawals,
    links,
    mainUrl: partnerStartLink(dash.botUsername, dash.profile.code),
  });
}

export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });
  const body = (await req.json()) as {
    action?: string;
    label?: string;
    slug?: string;
    amountPeaches?: number;
    payoutDetails?: string;
  };

  try {
    if (body.action === "create_link") {
      const link = await createPartnerLink(user.id, body.label || "Ссылка", body.slug);
      const dash = await getPartnerDashboard(user.id);
      return NextResponse.json({
        link: {
          ...link,
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
        userId: user.id,
        amountPeaches: Number(body.amountPeaches) || 0,
        payoutDetails: body.payoutDetails || "",
      });
      return NextResponse.json({ withdrawal: w });
    }
    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
