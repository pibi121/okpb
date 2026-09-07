import { prisma } from "@/lib/db";
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
const USER_REF_PREFIX = "u_";

export function parseStartPayload(payload: string | undefined): {
  affiliateCode?: string;
  linkSlug?: string;
  userReferralCode?: string;
  trafficCode?: string;
} {
  if (!payload?.trim()) return {};
  const p = payload.trim();
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
  const existing = await prisma.platformAccount.findUnique({
    where: {
      platform_platformUserId: {
        platform: "telegram",
        platformUserId,
      },
    },
    include: { user: true },
  });

  if (existing) {
    await prisma.platformAccount.update({
      where: { id: existing.id },
      data: {
        username: tg.username ?? null,
        firstName: tg.first_name ?? null,
        lastName: tg.last_name ?? null,
        languageCode: tg.language_code ?? null,
        lastSeenAt: new Date(),
      },
    });
    if (tg.language_code) {
      await prisma.user.update({
        where: { id: existing.user.id },
        data: { locale: normalizeLocale(tg.language_code) },
      });
    }
    const { trafficCode: existingTraffic } = parseStartPayload(startPayload);
    if (existingTraffic) await recordTrafficClick(existingTraffic);
    return prisma.user.findUniqueOrThrow({ where: { id: existing.user.id } });
  }

  const email = telegramSyntheticEmail(platformUserId);
  const randomSecret = cryptoRandom();
  const passwordHash = await hashPassword(randomSecret);

  const { affiliateCode, linkSlug, trafficCode } = parseStartPayload(startPayload);
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

  if (trafficCode) {
    await attributeTrafficSignup(user.id, trafficCode).catch(() => undefined);
  }

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
