import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { resolveTgApiUserId } from "@/lib/tg/resolve-api-user";
import { undressPeaches } from "@/lib/tg-pricing";
import {
  claimUndressLoot,
  undressStatus,
} from "@/lib/tg/undress-entitlement";
import { startTgUndressGeneration } from "@/lib/tg/undress-service";
import { normalizeLocale } from "@/lib/tg/i18n";
import { limits } from "@/lib/rate-limit";

async function tgPlatformUserId(userId: string): Promise<string | null> {
  const acc = await prisma.platformAccount.findFirst({
    where: { userId, platform: "telegram" },
    select: { platformUserId: true },
  });
  return acc?.platformUserId ?? null;
}

export async function GET(req: Request) {
  const userId = await resolveTgApiUserId(req);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const status = await undressStatus(userId);
  return NextResponse.json({
    pricePeaches: undressPeaches(),
    freeCredits: status.freeCredits,
    canLootToday: status.canLootToday,
  });
}

export async function POST(req: Request) {
  const userId = await resolveTgApiUserId(req);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!limits.generatePhoto(userId)) {
    return NextResponse.json(
      { error: "too_many_requests" },
      { status: 429 },
    );
  }

  const url = new URL(req.url);
  const action = url.searchParams.get("action") || "generate";
  const locale = normalizeLocale(url.searchParams.get("locale"));

  if (action === "loot") {
    const body = (await req.json().catch(() => ({}))) as {
      watchSeconds?: number;
    };
    const result = await claimUndressLoot(
      userId,
      Number(body.watchSeconds) || 0,
    );
    if (!result.ok) {
      return NextResponse.json(result, { status: 400 });
    }
    return NextResponse.json(result);
  }

  const form = await req.formData().catch(() => null);
  const file = form?.get("photo");
  if (!file || !(file instanceof Blob)) {
    return NextResponse.json({ error: "photo required" }, { status: 400 });
  }
  const ab = await file.arrayBuffer();
  const photoBytes = Buffer.from(ab);
  if (photoBytes.length < 100) {
    return NextResponse.json({ error: "empty photo" }, { status: 400 });
  }

  const platformUserId = await tgPlatformUserId(userId);
  if (!platformUserId) {
    return NextResponse.json({ error: "No Telegram account" }, { status: 400 });
  }

  try {
    const out = await startTgUndressGeneration({
      userId,
      platformUserId,
      photoBytes,
      locale,
    });
    return NextResponse.json({
      ok: true,
      galleryItemId: out.galleryItemId,
      chargedPeaches: out.chargedPeaches,
      usedFree: out.usedFree,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status = /Недостаточно|free_race/i.test(msg) ? 402 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
