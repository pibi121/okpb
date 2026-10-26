import { isTransientDbError, prisma, withDbRetry } from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import {
  telegramSyntheticEmail,
  type TelegramWebAppUser,
} from "@/lib/tg/auth";
import { normalizeLocale } from "@/lib/tg/i18n";
import {
  attributeUserToPartner,
  parsePartnerRefPayload,
  recordPartnerClick,
} from "@/lib/tg/partner-program";
import {
  attributeTrafficSignup,
  parseTrafficPayload,
  recordTrafficClick,
} from "@/lib/ops/traffic";

export type TelegramBotUser = {
  id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
  language_code?: string;
};

const REF_PREFIX = "ref_";
const DEAL_PREFIX = "dref_";
const USER_REF_PREFIX = "u_";

export function parseStartPayload(payload: string | undefined): {
  affiliateCode?: string;
  linkSlug?: string;
  userReferralCode?: string;
  trafficCode?: string;
  cabinetCode?: string;
  cabinetSlug?: string;
} {
  if (!payload?.trim()) return {};
  const p = payload.trim();
  if (p.startsWith(DEAL_PREFIX)) {
    const raw = p.slice(DEAL_PREFIX.length);
    const sep = raw.indexOf("__");
    const cabinetCode = (sep >= 0 ? raw.slice(0, sep) : raw).trim().toLowerCase();
    const cabinetSlug = sep >= 0 ? raw.slice(sep + 2).trim().toLowerCase() : "";
    if (!cabinetCode) return {};
    return { cabinetCode, cabinetSlug: cabinetSlug || undefined };
  }
  if (p.startsWith(REF_PREFIX)) {
    const { code, linkSlug } = parsePartnerRefPayload(p);
    if (code) return { affiliateCode: code, linkSlug };
    return { affiliateCode: p.slice(REF_PREFIX.length) };
  }
  if (p.startsWith(USER_REF_PREFIX)) {
    return { userReferralCode: p.slice(USER_REF_PREFIX.length) };
  }
  if (p.startsWith("m_")) {
    const trafficCode = parseTrafficPayload(p);
    if (trafficCode) return { trafficCode };
  }
  return {};
}

export async function findOrCreateTelegramUser(
  tg: TelegramWebAppUser,
  startPayload?: string,
) {
  const platformUserId = String(tg.id);
  const existing = await withDbRetry(() =>
    prisma.platformAccount.findUnique({
      where: {
        platform_platformUserId: {
          platform: "telegram",
          platformUserId,
        },
      },
      include: { user: true },
    }),
  );

  if (existing) {
    const username = tg.username ?? null;
    const firstName = tg.first_name ?? null;
    const lastName = tg.last_name ?? null;
    const languageCode = tg.language_code ?? null;
    const profileSame =
      (existing.username || null) === username &&
      (existing.firstName || null) === firstName &&
      (existing.lastName || null) === lastName &&
      (existing.languageCode || null) === languageCode;
    const seenFresh =
      Date.now() - new Date(existing.lastSeenAt).getTime() < 60_000;
    // A slow profile touch must not drop the button. Skip it when nothing changed.
    if (!profileSame || !seenFresh) {
      await withDbRetry(() =>
        prisma.platformAccount.update({
          where: { id: existing.id },
          data: {
            username,
            firstName,
            lastName,
            languageCode,
            lastSeenAt: new Date(),
          },
        }),
      ).catch((e) => {
        console.warn(
          "[tg] profile touch skipped:",
          isTransientDbError(e) ? "db slow" : e instanceof Error ? e.message : e,
        );
      });
    }
    const nextLocale = languageCode ? normalizeLocale(languageCode) : null;
    if (nextLocale && existing.user.locale !== nextLocale) {
      const saved = await withDbRetry(() =>
        prisma.user.update({
          where: { id: existing.user.id },
          data: { locale: nextLocale },
        }),
      )
        .then(() => true)
        .catch((e) => {
          console.warn(
            "[tg] locale touch skipped:",
            isTransientDbError(e) ? "db slow" : e instanceof Error ? e.message : e,
          );
          return false;
        });
      if (saved) existing.user.locale = nextLocale;
    }
    // First-touch partner/traffic: existing users may hit /start ref_… after an
    // earlier create without payload (e.g. Mini App auth or pre-/start findOrCreate).
    const {
      affiliateCode: existingAffiliate,
      linkSlug: existingLinkSlug,
      trafficCode: existingTraffic,
      cabinetCode: existingCabinet,
      cabinetSlug: existingCabinetSlug,
    } = parseStartPayload(startPayload);
    if (existingTraffic) {
      await recordTrafficClick(existingTraffic);
      await attributeTrafficSignup(existing.user.id, existingTraffic).catch(
        () => undefined,
      );
    }
    if (existingAffiliate) {
      const [already, dealAlready] = await Promise.all([
        prisma.partnerAttribution.findUnique({
          where: { userId: existing.user.id },
          select: { id: true },
        }),
        prisma.cabinetAttribution.findUnique({
          where: { userId: existing.user.id },
          select: { id: true },
        }),
      ]);
      if (!already && !dealAlready) {
        const partner = await prisma.partnerProfile.findFirst({
          where: { code: existingAffiliate, status: "active" },
        });
        if (partner && partner.userId !== existing.user.id) {
          await recordPartnerClick(existingAffiliate, existingLinkSlug);
          await attributeUserToPartner({
            userId: existing.user.id,
            code: existingAffiliate,
            linkSlug: existingLinkSlug,
          }).catch(() => undefined);
        }
      }
    }
    if (existingCabinet) {
      const { touchCabinetStart } = await import("@/lib/cabinet/service");
      await touchCabinetStart({
        userId: existing.user.id,
        code: existingCabinet,
        slug: existingCabinetSlug,
      }).catch(() => undefined);
    }
    return existing.user;
  }

  const {
    assertTelegramSignupAllowed,
  } = await import("@/lib/tg/signup-rate-limit");
  await assertTelegramSignupAllowed();

  const email = telegramSyntheticEmail(platformUserId);
  const randomSecret = cryptoRandom();
  const passwordHash = await hashPassword(randomSecret);

  const { affiliateCode, linkSlug, trafficCode, cabinetCode, cabinetSlug } =
    parseStartPayload(startPayload);
  let affiliateId: string | undefined;
  let partnerCode: string | undefined;

  if (affiliateCode) {
    const partner = await prisma.partnerProfile.findFirst({
      where: { code: affiliateCode, status: "active" },
    });
    if (partner) {
      partnerCode = affiliateCode;
      await recordPartnerClick(affiliateCode, linkSlug);
    } else {
      const aff = await prisma.affiliateAccount.findFirst({
        where: { code: affiliateCode, status: "active" },
      });
      affiliateId = aff?.id;
    }
  }

  if (trafficCode) await recordTrafficClick(trafficCode);

  const displayName =
    [tg.first_name, tg.last_name].filter(Boolean).join(" ") ||
    tg.username ||
    "User";

  const locale = normalizeLocale(tg.language_code);

  const user = await prisma.user.create({
    data: {
      email,
      passwordHash,
      name: displayName,
      source: "telegram",
      locale,
      ageConfirmed: false,
      balancePeaches: 0,
      credits: 0,
      platformAccounts: {
        create: {
          platform: "telegram",
          platformUserId,
          username: tg.username ?? null,
          firstName: tg.first_name ?? null,
          lastName: tg.last_name ?? null,
          languageCode: tg.language_code ?? null,
        },
      },
      ...(affiliateId
        ? {
            affiliateAttributions: {
              create: { affiliateId },
            },
          }
        : {}),
    },
  });

  if (partnerCode) {
    await attributeUserToPartner({
      userId: user.id,
      code: partnerCode,
      linkSlug,
    }).catch(() => {
      /* already attributed */
    });
  }

  if (cabinetCode) {
    const { touchCabinetStart } = await import("@/lib/cabinet/service");
    await touchCabinetStart({
      userId: user.id,
      code: cabinetCode,
      slug: cabinetSlug,
    }).catch(() => undefined);
  }

  if (trafficCode) {
    await attributeTrafficSignup(user.id, trafficCode).catch(() => undefined);
  }

  void import("@/lib/ops/ops-telegram")
    .then(async ({ notifyOpsSignup }) => {
      let botUsername: string | null = null;
      try {
        const { currentTgBot } = await import("@/lib/tg/bot-context");
        botUsername = currentTgBot()?.username || null;
      } catch {
        /* ignore */
      }
      if (!botUsername) {
        try {
          const { getPrimaryBotUsername } = await import("@/lib/tg/bot-config");
          botUsername = await getPrimaryBotUsername();
        } catch {
          botUsername = null;
        }
      }
      await notifyOpsSignup({
        userId: user.id,
        via: "telegram",
        botUsername,
      });
    })
    .catch(() => undefined);

  return user;
}

export async function findOrCreateTelegramUserFromBot(
  tg: TelegramBotUser,
  startPayload?: string,
) {
  return findOrCreateTelegramUser(
    {
      id: tg.id,
      username: tg.username,
      first_name: tg.first_name,
      last_name: tg.last_name,
      language_code: tg.language_code,
    },
    startPayload,
  );
}

function cryptoRandom(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

export async function getTelegramUserId(userId: string): Promise<string | null> {
  const acc = await prisma.platformAccount.findFirst({
    where: { userId, platform: "telegram" },
  });
  return acc?.platformUserId ?? null;
}
