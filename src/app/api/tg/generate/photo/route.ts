import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { resolveTgApiUserId } from "@/lib/tg/resolve-api-user";
import { setActiveTgCharacter } from "@/lib/tg/character-service";
import { startTgPhotoGeneration } from "@/lib/tg/generation-service";
import { templatePriceLabel } from "@/lib/tg/generation-flow";
import { getPhotoTemplate } from "@/lib/photo-template";
import { normalizeLocale } from "@/lib/tg/i18n";
import { getBalancePeaches } from "@/lib/tg/wallet";
import { canUseStudioDailyFree } from "@/lib/tg/tg-promo";

async function tgPlatformUserId(userId: string): Promise<string | null> {
  const acc = await prisma.platformAccount.findFirst({
    where: { userId, platform: "telegram" },
    select: { platformUserId: true },
  });
  return acc?.platformUserId ?? null;
}

/** Start studio-cast photo generation from Mini App. */
export async function POST(req: Request) {
  const userId = await resolveTgApiUserId(req);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    templateId?: string;
    castId?: string;
    characterId?: string;
    locale?: string;
  };

  const characterId = body.characterId || body.castId;
  if (!body.templateId || !characterId) {
    return NextResponse.json(
      { error: "templateId and characterId required" },
      { status: 400 },
    );
  }

  const locale = normalizeLocale(body.locale);
  const character = await prisma.character.findFirst({
    where: {
      id: characterId,
      OR: [{ userId }, { isStudioCast: true }],
    },
  });
  if (!character) {
    return NextResponse.json({ error: "Character not found" }, { status: 404 });
  }

  const tpl = await getPhotoTemplate(body.templateId);
  if (!tpl) {
    return NextResponse.json({ error: "Template not found" }, { status: 404 });
  }

  const platformUserId = await tgPlatformUserId(userId);
  if (!platformUserId) {
    return NextResponse.json({ error: "No Telegram account" }, { status: 400 });
  }

  await setActiveTgCharacter(platformUserId, character.id);

  const pricing = await templatePriceLabel({
    userId,
    kind: "photo",
    templateId: body.templateId,
    locale,
    character,
  });

  if (pricing.price > 0) {
    const bal = await getBalancePeaches(userId);
    if (bal < pricing.price) {
      return NextResponse.json(
        { error: "insufficient_balance", need: pricing.price, balance: bal },
        { status: 402 },
      );
    }
  }

  const studioDaily =
    pricing.studioDaily || (await canUseStudioDailyFree(userId));

  try {
    const result = await startTgPhotoGeneration({
      userId,
      platformUserId,
      templateId: body.templateId,
      characterId: character.id,
      studioDaily: Boolean(studioDaily && pricing.freePhoto),
      loraWelcome: false,
    });
    return NextResponse.json({
      ok: true,
      galleryItemId: result.galleryItemId,
      message: locale === "en" ? "Generation started" : "Генерация запущена",
      price: pricing.price,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
