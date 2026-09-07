import { prisma } from "@/lib/db";
import { getOpsSettings, opsMessage } from "@/lib/ops/settings";
import { formatNotice } from "@/lib/ops/notices";
import { normalizeLocale, type TgLocale } from "@/lib/tg/i18n";

export type GateBlock =
  | { ok: true }
  | { ok: false; reason: "blocked" | "maintenance"; message: string };

export async function assertUserCanUseBot(
  userId: string,
  localeRaw?: string | null,
): Promise<GateBlock> {
  const locale: TgLocale = normalizeLocale(localeRaw);
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { blocked: true, locale: true },
  });
  if (!user) return { ok: true };
  const loc = locale || normalizeLocale(user.locale);
  if (user.blocked) {
    const msg =
      (await formatNotice("account_limited", loc)) ||
      (loc === "en"
        ? "Access to the bot is limited."
        : "Доступ к боту ограничен.");
    return { ok: false, reason: "blocked", message: msg };
  }
  const settings = await getOpsSettings();
  if (settings.maintenance) {
    return {
      ok: false,
      reason: "maintenance",
      message: opsMessage(settings, "maintenance", loc),
    };
  }
  return { ok: true };
}

export async function generationHoldMessage(
  locale: TgLocale,
): Promise<string | null> {
  const settings = await getOpsSettings();
  if (settings.maintenance) return opsMessage(settings, "maintenance", locale);
  if (settings.loadMode) return opsMessage(settings, "load", locale);
  return null;
}
