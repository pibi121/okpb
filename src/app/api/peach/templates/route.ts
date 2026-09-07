import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { createTemplatePack, listTemplatePacks } from "@/lib/template-pack";

export const runtime = "nodejs";

export async function GET() {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });
  const packs = await listTemplatePacks(user.id);
  return NextResponse.json({ packs });
}

const createSchema = z.object({
  title: z.string().min(1),
  idea: z.string().optional(),
  tags: z.array(z.string()).optional(),
  locationNote: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });
  try {
    const body = createSchema.parse(await req.json());
    const pack = await createTemplatePack(user.id, body);
    return NextResponse.json({ pack });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
