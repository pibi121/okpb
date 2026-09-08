import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  parseTelegramUser,
  validateTelegramInitDataDetailed,
} from "@/lib/tg/auth";
import { findOrCreateTelegramUser } from "@/lib/tg/user";
import { createSession } from "@/lib/auth";
import { TG_PROMO } from "@/lib/tg-pricing";
import { listActiveBotTokens } from "@/lib/tg/bot-registry";

/** Mini App / bot: exchange initData for web session cookie (any active dual bot token). */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    initData?: string;
    startPayload?: string;
    locale?: string;
  };

  const tokens = await listActiveBotTokens();
  if (!tokens.length) {
    return NextResponse.json(
      { error: "TELEGRAM_BOT_TOKEN not configured" },
      { status: 503 },
    );
  }

  const initData = body.initData || "";
  let checked: ReturnType<typeof validateTelegramInitDataDetailed> | null = null;
  for (const token of tokens) {
    const r = validateTelegramInitDataDetailed(initData, token);
    if (r.ok) {
      checked = r;
      break;
    }
    checked = r;
  }
  if (!checked || !checked.ok) {
    console.warn("[tg-auth] invalid initData", {
      reason: checked && !checked.ok ? checked.reason : "unknown",
      len: initData.length,
      tokensTried: tokens.length,
    });
    return NextResponse.json(
      {
        error: "Invalid initData",
        reason: checked && !checked.ok ? checked.reason : "bad_hash",
      },
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
