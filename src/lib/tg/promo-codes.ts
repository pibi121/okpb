import { prisma } from "@/lib/db";
import { creditPeaches, getBalancePeaches } from "@/lib/tg/wallet";
import type { TgLocale } from "@/lib/tg/i18n";

export function normalizePromoCode(text: string): string {
  return text.trim().replace(/\s+/g, "").toUpperCase();
}

/**
 * If the message matches an enabled (or exhausted/disabled) promo code row, redeem.
 * Returns null when the text is not a known promo code at all.
 */
export async function tryRedeemPromoMessage(
  userId: string,
  rawText: string,
  locale: TgLocale = "ru",
): Promise<
  | { handled: false }
  | { handled: true; ok: true; balance: number; amount: number }
  | { handled: true; ok: false; message: string }
> {
  const code = normalizePromoCode(rawText);
  if (!code || code.length < 3 || code.length > 48) return { handled: false };
  if (/\s/.test(rawText.trim())) return { handled: false };

  const promo = await prisma.promoCode.findUnique({ where: { code } });
  if (!promo) return { handled: false };

  if (!promo.enabled) {
    return {
      handled: true,
      ok: false,
      message: locale === "en" ? "This promo is disabled." : "Промокод отключён.",
    };
  }

  if (promo.redeemedCount >= promo.maxRedemptions) {
    return {
      handled: true,
      ok: false,
      message:
        locale === "en"
          ? "This promo code is already used up."
          : "Промокод уже исчерпан.",
    };
  }

  const existing = await prisma.promoRedemption.findUnique({
    where: {
      promoCodeId_userId: { promoCodeId: promo.id, userId },
    },
  });
  if (existing) {
    return {
      handled: true,
      ok: false,
      message:
        locale === "en"
          ? "You already used this promo code."
          : "Ты уже активировал этот промокод.",
    };
  }

  try {
    await prisma.$transaction(async (tx) => {
      const fresh = await tx.promoCode.findUnique({ where: { id: promo.id } });
      if (!fresh || !fresh.enabled || fresh.redeemedCount >= fresh.maxRedemptions) {
        throw new Error("exhausted");
      }
      await tx.promoRedemption.create({
        data: { promoCodeId: promo.id, userId },
      });
      await tx.promoCode.update({
        where: { id: promo.id },
        data: { redeemedCount: { increment: 1 } },
      });
    });
  } catch {
    return {
      handled: true,
      ok: false,
      message:
        locale === "en"
          ? "Could not redeem (already used or exhausted)."
          : "Не удалось активировать (уже использован или исчерпан).",
    };
  }

  await creditPeaches(userId, promo.amountPeaches, `promo_${promo.code}`, {
    promoCodeId: promo.id,
    code: promo.code,
  });
  const balance = await getBalancePeaches(userId);
  return { handled: true, ok: true, balance, amount: promo.amountPeaches };
}
