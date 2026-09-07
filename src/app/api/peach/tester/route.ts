import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  enqueueTesterSession,
  rateTesterVariant,
  summarizeSessions,
} from "@/lib/tester-jobs";

export const runtime = "nodejs";
export const maxDuration = 900;

const createSchema = z.object({
  action: z.literal("create"),
  title: z.string().optional(),
  characterMode: z.enum(["none", "lookbook", "lora"]),
  characterIds: z.array(z.string()).optional(),
  poseOn: z.boolean(),
  poseId: z.string().optional(),
  styleOn: z.boolean(),
  styleId: z.string().optional(),
  userNote: z.string().optional(),
  variationCount: z.number().int().min(2).max(4).optional(),
  width: z.number().int().optional(),
  height: z.number().int().optional(),
  skinDetail: z.boolean().optional(),
  skinDetailStrength: z.number().min(0).max(3.5).optional(),
});

const rateSchema = z.object({
  action: z.literal("rate"),
  variantId: z.string(),
  quality: z.union([z.literal(1), z.literal(-1), z.null()]).optional(),
  face: z.union([z.literal(1), z.literal(-1), z.null()]).optional(),
  promptFit: z.union([z.literal(1), z.literal(-1), z.null()]).optional(),
  poseFit: z.union([z.literal(1), z.literal(-1), z.null()]).optional(),
  note: z.string().optional(),
});

export async function GET(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });

  const id = req.nextUrl.searchParams.get("id");
  if (id) {
    const session = await prisma.testSession.findFirst({
      where: { id, userId: user.id },
      include: { variants: { orderBy: { index: "asc" } } },
    });
    if (!session) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ session });
  }

  const sessions = await prisma.testSession.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    take: 40,
    include: { variants: { orderBy: { index: "asc" } } },
  });
  const summary = summarizeSessions(sessions);
  return NextResponse.json({ sessions, summary });
}

export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });

  const body = await req.json();
  try {
    if (body?.action === "create") {
      const data = createSchema.parse(body);
      const session = await enqueueTesterSession({ userId: user.id, ...data });
      return NextResponse.json({ session });
    }
    if (body?.action === "rate") {
      const data = rateSchema.parse(body);
      const variant = await rateTesterVariant(user.id, data.variantId, data);
      return NextResponse.json({ variant });
    }
    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
