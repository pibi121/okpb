import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { purchaseQuickVideoTemplate } from "@/lib/quick-video-template";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: Request, ctx: Ctx) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });
  const { id } = await ctx.params;
  try {
    const template = await purchaseQuickVideoTemplate(user.id, id);
    const balance = (
      await import("@/lib/db").then((m) =>
        m.prisma.user.findUnique({
          where: { id: user.id },
          select: { credits: true },
        }),
      )
    )?.credits;
    return NextResponse.json({ template, balance });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    const status = msg.includes("кредит") ? 402 : 400;
    return NextResponse.json({ error: msg }, { status });
  }
}
