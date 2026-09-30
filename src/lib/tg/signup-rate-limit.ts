/**
 * Global rate limit for NEW Telegram user creation.
 * Stops signup floods (many /start in seconds) without affecting returning users.
 *
 * Env (optional):
 *   TG_SIGNUP_RATE_MAX=40
 *   TG_SIGNUP_RATE_WINDOW_SEC=60
 */
import { prisma } from "@/lib/db";

export class TelegramSignupRateLimitedError extends Error {
  code = "tg_signup_rate_limited" as const;
  constructor() {
    super("telegram_signup_rate_limited");
    this.name = "TelegramSignupRateLimitedError";
  }
}

function maxNewUsers(): number {
  const n = Number(process.env.TG_SIGNUP_RATE_MAX);
  if (Number.isFinite(n) && n > 0) return Math.floor(n);
  return 40;
}

function windowMs(): number {
  const sec = Number(process.env.TG_SIGNUP_RATE_WINDOW_SEC);
  if (Number.isFinite(sec) && sec > 0) return Math.floor(sec) * 1000;
  return 60_000;
}

/** Call only on the create-new-user path (not for existing accounts). */
export async function assertTelegramSignupAllowed(): Promise<void> {
  const max = maxNewUsers();
  const win = windowMs();
  const since = new Date(Date.now() - win);
  const n = await prisma.user.count({
    where: {
      source: "telegram",
      createdAt: { gte: since },
    },
  });
  if (n >= max) {
    console.warn("[tg-signup-rate] blocked", {
      recent: n,
      max,
      windowSec: Math.round(win / 1000),
    });
    throw new TelegramSignupRateLimitedError();
  }
}

export function signupRateLimitedMessage(locale: "ru" | "en" = "ru"): string {
  if (locale === "en") {
    return "Too many new connections right now. Please wait about a minute and press Start again.";
  }
  return "Сейчас слишком много новых подключений. Подожди около минуты и нажми /start ещё раз.";
}
