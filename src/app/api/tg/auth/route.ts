import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  parseTelegramUser,
  validateTelegramInitDataDetailed,
} from "@/lib/tg/auth";
import { findOrCreateTelegramUser } from "@/lib/tg/user";
import { createSession } from "@/lib/auth";
import { TG_PROMO } from "@/lib/tg-pricing";

function botToken() {
  return process.env.TELEGRAM_BOT_TOKEN || "";
}

/** Mini App / bot: exchange initData for web session cookie. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    initData?: string;
    startPayload?: string;
    locale?: string;
  };
  const token = botToken();
  if (!token) {
    return NextResponse.json(
      { error: "TELEGRAM_BOT_TOKEN not configured" },
      { status: 503 },
    );
  }

  const initData = body.initData || "";
  const checked = validateTelegramInitDataDetailed(initData, token);
  if (!checked.ok) {
    console.warn("[tg-auth] invalid initData", {
      reason: checked.reason,
      len: initData.length,
      hasSig: /(?:^|&)signature=/.test(initData),
      hasUser: /(?:^|&)user=/.test(initData),
      hasHash: /(?:^|&)hash=/.test(initData),
    });
    return NextResponse.json(
      { error: "Invalid initData", reason: checked.reason },
      { status: 401 },
    );
  }

  const tgUser = parseTelegramUser(checked.fields);
  if (!tgUser) {
    return NextResponse.json({ error: "No user in initData" }, { status: 400 });
  }

  let user = await findOrCreateTelegramUser(tgUser, body.startPayload);

  if (body.locale && (body.locale === "en" || body.locale === "ru")) {
    user = await prisma.user.update({
      where: { id: user.id },
      data: { locale: body.locale },
    });
  }

  await createSession(user.id);

  return NextResponse.json({
    ok: true,
    userId: user.id,
    balancePeaches: user.balancePeaches,
    locale: user.locale,
    ageConfirmed: user.ageConfirmed,
    name: user.name,
    promos: {
      studioDailyFreeReady: user.tgStudioFreeReady,
      loraWelcomePhotosLeft: user.tgLoraWelcomePhotosLeft,
      firstVideoDiscountAvailable: !user.tgFirstVideoDiscountUsed,
      firstVideoDiscountPct: TG_PROMO.firstVideoDiscountPct,
    },
  });
}
