import { creditPeaches, getBalancePeaches } from "@/lib/tg/wallet";
import type { TgLocale } from "@/lib/tg/i18n";

/** Legacy one-shot test code (kept for old chats). */
export const TG_TEST_PROMO_CODE = "НАЧИСЛИ500";
export const TG_TEST_PROMO_AMOUNT = 500;
const LEDGER_REASON_ONCE = "promo_nachisli500";

/** Unlimited test top-up while QA is open. */
export const TG_TEST_PROMO_CODE_UNLIMITED = "НАЧИСЛИ10000";
export const TG_TEST_PROMO_AMOUNT_UNLIMITED = 10_000;
const LEDGER_REASON_UNLIMITED = "promo_nachisli10000";

function normalizePromoInput(text: string): string {
  return text.trim().replace(/\s+/g, "").toUpperCase();
}

export function isTestPromoMessage(text: string): boolean {
  const norm = normalizePromoInput(text);
  return (
    norm === normalizePromoInput(TG_TEST_PROMO_CODE) ||
    norm === normalizePromoInput(TG_TEST_PROMO_CODE_UNLIMITED)
  );
}

export async function redeemTestPromo(
  userId: string,
  locale: TgLocale = "ru",
  rawText?: string,
): Promise<{ ok: true; balance: number; amount: number } | { ok: false; message: string }> {
  const norm = normalizePromoInput(rawText || TG_TEST_PROMO_CODE_UNLIMITED);

  if (norm === normalizePromoInput(TG_TEST_PROMO_CODE_UNLIMITED)) {
    await creditPeaches(userId, TG_TEST_PROMO_AMOUNT_UNLIMITED, LEDGER_REASON_UNLIMITED, {
      code: TG_TEST_PROMO_CODE_UNLIMITED,
      unlimited: true,
    });
    const balance = await getBalancePeaches(userId);
    return { ok: true, balance, amount: TG_TEST_PROMO_AMOUNT_UNLIMITED };
  }

  // Legacy НАЧИСЛИ500 — still one redemption per user.
  const { prisma } = await import("@/lib/db");
  const used = await prisma.ledgerEntry.findFirst({
    where: { userId, reason: LEDGER_REASON_ONCE },
    select: { id: true },
  });
  if (used) {
    return {
      ok: false,
      message:
        locale === "en"
          ? `This code was already used. For testing send ${TG_TEST_PROMO_CODE_UNLIMITED} (unlimited).`
          : `Этот код уже использован. Для теста напиши ${TG_TEST_PROMO_CODE_UNLIMITED} (без лимита).`,
    };
  }

  await creditPeaches(userId, TG_TEST_PROMO_AMOUNT, LEDGER_REASON_ONCE, {
    code: TG_TEST_PROMO_CODE,
  });
  const balance = await getBalancePeaches(userId);
  return { ok: true, balance, amount: TG_TEST_PROMO_AMOUNT };
}
