import { prisma } from "@/lib/db";
import { t } from "@/lib/tg/i18n";
import { tgSendMediaMessage } from "@/lib/tg/media-assets";
import { tgMiniAppUrl, tgLoraTrainMiniAppUrl } from "@/lib/tg/miniapp-url";
import { castsMiniAppUrl } from "@/lib/tg/studio-cast";
import { tgSendMessage, tgSendVideoNote } from "@/lib/tg/telegram-api";
import { getOpsSettings } from "@/lib/ops/settings";

const MS_5M = 5 * 60 * 1000;
const MS_10M = 10 * 60 * 1000;
const MS_40M = 40 * 60 * 1000;
const MS_6H = 6 * 60 * 60 * 1000;
const MS_3D = 3 * 24 * 60 * 60 * 1000;
const MS_7D = 7 * 24 * 60 * 60 * 1000;

/** Anchor drip timers at welcome-after-rules. Keeps old welcome_free_push intact. */
export async function scheduleFunnelDrip(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: {
      tgFunnelAnchorAt: new Date(),
      tgFunnel5mSent: false,
      tgFunnel10mIdleSent: false,
      tgFunnel40mSent: false,
      tgFunnel6hSent: false,
    },
  });
}

async function userHasAnyGeneration(userId: string): Promise<boolean> {
  const [gallery, videoRuns] = await Promise.all([
    prisma.galleryItem.findFirst({
      where: { userId },
      select: { id: true },
    }),
    prisma.quickVideoRun.findFirst({
      where: { userId },
      select: { id: true },
    }),
  ]);
  return Boolean(gallery || videoRuns);
}

function studioKeyboard(locale: "ru" | "en" = "ru") {
  return {
    inline_keyboard: [
      [{ text: t("funnel_40m_btn", locale), web_app: { url: tgMiniAppUrl() } }],
    ],
  };
}

function feedKeyboard(locale: "ru" | "en" = "ru") {
  return {
    inline_keyboard: [
      [{ text: t("funnel_6h_btn", locale), web_app: { url: tgMiniAppUrl() } }],
    ],
  };
}

function fiveMinKeyboard(locale: "ru" | "en" = "ru") {
  return {
    inline_keyboard: [
      [
        {
          text: t("funnel_5m_btn_train", locale),
          web_app: { url: tgLoraTrainMiniAppUrl() },
        },
      ],
      [
        {
          text: t("funnel_5m_btn_cast", locale),
          web_app: { url: castsMiniAppUrl() },
        },
      ],
      [
        {
          text: t("funnel_5m_btn_video", locale),
          web_app: { url: tgMiniAppUrl("video") },
        },
      ],
    ],
  };
}

async function sendFunnel5m(chatId: number) {
  await tgSendMediaMessage(chatId, "funnel_5m", t("funnel_5m", "ru"), {
    reply_markup: fiveMinKeyboard("ru"),
  });
}

async function sendFunnel40m(chatId: number) {
  await tgSendMediaMessage(chatId, "funnel_40m", t("funnel_40m", "ru"), {
    reply_markup: studioKeyboard("ru"),
  });
}

async function sendFunnel6h(chatId: number) {
  await tgSendMediaMessage(chatId, "funnel_6h", t("funnel_6h", "ru"), {
    reply_markup: feedKeyboard("ru"),
  });
}

async function sendFunnel10mIdle(chatId: number, locale: "ru" | "en") {
  const settings = await getOpsSettings();
  const noteId =
    locale === "en"
      ? settings.tgFunnelNoteEnFileId || settings.tgFunnelNoteRuFileId
      : settings.tgFunnelNoteRuFileId || settings.tgFunnelNoteEnFileId;
  if (noteId) {
    try {
      await tgSendVideoNote(chatId, noteId);
    } catch (e) {
      console.error("[tg-funnel] video_note failed:", e);
    }
  }
  await tgSendMessage(chatId, t("funnel_10m_idle", "ru"), {
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: t("funnel_10m_btn", "ru"),
            web_app: { url: tgMiniAppUrl() },
          },
        ],
      ],
    },
  });
}

type FunnelUser = {
  id: string;
  locale: string;
  tgFunnelAnchorAt: Date | null;
  tgFunnel5mSent: boolean;
  tgFunnel10mIdleSent: boolean;
  tgFunnel40mSent: boolean;
  tgFunnel6hSent: boolean;
};

async function sendIdleWinback(
  chatId: number,
  locale: "ru" | "en",
  kind: "3d" | "7d",
) {
  const body = kind === "3d" ? t("idle_3d", locale) : t("idle_7d", locale);
  await tgSendMessage(chatId, body, {
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: t("idle_view_templates_btn", locale),
            web_app: { url: tgMiniAppUrl() },
          },
        ],
        [
          {
            text: t("idle_topup_btn", locale),
            callback_data: "tu:open",
          },
        ],
      ],
    },
  });
}

/** Winback for users idle in bot + Mini App for 3 / 7 days. */
export async function maybeSendIdleWinbacks(
  chatId: number,
  userId: string,
): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      ageConfirmed: true,
      locale: true,
      createdAt: true,
      tgLastActiveAt: true,
      tgLastMiniAppAt: true,
      tgIdle3dSent: true,
      tgIdle7dSent: true,
    },
  });
  if (!user?.ageConfirmed) return;

  const locale = user.locale === "en" ? "en" : "ru";

  // First boot / missing clock: start idle timer now, do not blast from createdAt.
  if (!user.tgLastActiveAt) {
    await prisma.user.update({
      where: { id: userId },
      data: { tgLastActiveAt: new Date() },
    });
    return;
  }

  const last = user.tgLastActiveAt;
  const idleFor = Date.now() - last.getTime();

  if (!user.tgIdle7dSent && idleFor >= MS_7D) {
    try {
      await sendIdleWinback(chatId, locale, "7d");
    } catch (e) {
      console.error("[tg-idle] 7d", userId, e);
      // Still mark sent — blocked users / hard fails must not retry forever.
    }
    await prisma.user.update({
      where: { id: userId },
      data: { tgIdle7dSent: true, tgIdle3dSent: true },
    });
    const { trackFunnelEventBg } = await import("@/lib/ops/funnel-track");
    trackFunnelEventBg({
      userId,
      platformUserId: String(chatId),
      eventKey: "system.drip.idle_7d",
      surface: "system",
    });
    return;
  }

  if (!user.tgIdle3dSent && idleFor >= MS_3D) {
    try {
      await sendIdleWinback(chatId, locale, "3d");
    } catch (e) {
      console.error("[tg-idle] 3d", userId, e);
      // Still mark sent — blocked users / hard fails must not retry forever.
    }
    await prisma.user.update({
      where: { id: userId },
      data: { tgIdle3dSent: true },
    });
    const { trackFunnelEventBg } = await import("@/lib/ops/funnel-track");
    trackFunnelEventBg({
      userId,
      platformUserId: String(chatId),
      eventKey: "system.drip.idle_3d",
      surface: "system",
    });
  }
}

/** Send due drips for one user (also safe to call on inbound messages). */
export async function maybeSendFunnelDrips(
  chatId: number,
  userId: string,
): Promise<void> {
  const user = (await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      locale: true,
      tgFunnelAnchorAt: true,
      tgFunnel5mSent: true,
      tgFunnel10mIdleSent: true,
      tgFunnel40mSent: true,
      tgFunnel6hSent: true,
    },
  })) as FunnelUser | null;
  if (!user?.tgFunnelAnchorAt) return;

  const anchor = user.tgFunnelAnchorAt.getTime();
  const now = Date.now();
  const locale = user.locale === "en" ? "en" : "ru";

  if (!user.tgFunnel5mSent && now >= anchor + MS_5M) {
    try {
      await sendFunnel5m(chatId);
    } catch (e) {
      console.error("[tg-funnel] 5m", userId, e);
      return;
    }
    await prisma.user.update({
      where: { id: userId },
      data: { tgFunnel5mSent: true },
    });
    user.tgFunnel5mSent = true;
    const { trackFunnelEventBg } = await import("@/lib/ops/funnel-track");
    trackFunnelEventBg({
      userId,
      platformUserId: String(chatId),
      eventKey: "system.drip.5m",
      surface: "system",
    });
  }

  if (!user.tgFunnel10mIdleSent && now >= anchor + MS_10M) {
    const hasGen = await userHasAnyGeneration(userId);
    if (hasGen) {
      await prisma.user.update({
        where: { id: userId },
        data: { tgFunnel10mIdleSent: true },
      });
      user.tgFunnel10mIdleSent = true;
    } else {
      try {
        await sendFunnel10mIdle(chatId, locale);
      } catch (e) {
        console.error("[tg-funnel] 10m", userId, e);
        return;
      }
      await prisma.user.update({
        where: { id: userId },
        data: { tgFunnel10mIdleSent: true },
      });
      user.tgFunnel10mIdleSent = true;
      const { trackFunnelEventBg } = await import("@/lib/ops/funnel-track");
      trackFunnelEventBg({
        userId,
        platformUserId: String(chatId),
        eventKey: "system.drip.10m_idle",
        surface: "system",
      });
    }
  }

  if (!user.tgFunnel40mSent && now >= anchor + MS_40M) {
    try {
      await sendFunnel40m(chatId);
    } catch (e) {
      console.error("[tg-funnel] 40m", userId, e);
      return;
    }
    await prisma.user.update({
      where: { id: userId },
      data: { tgFunnel40mSent: true },
    });
    user.tgFunnel40mSent = true;
    const { trackFunnelEventBg } = await import("@/lib/ops/funnel-track");
    trackFunnelEventBg({
      userId,
      platformUserId: String(chatId),
      eventKey: "system.drip.40m",
      surface: "system",
    });
  }

  if (!user.tgFunnel6hSent && now >= anchor + MS_6H) {
    try {
      await sendFunnel6h(chatId);
    } catch (e) {
      console.error("[tg-funnel] 6h", userId, e);
      return;
    }
    await prisma.user.update({
      where: { id: userId },
      data: { tgFunnel6hSent: true },
    });
    const { trackFunnelEventBg } = await import("@/lib/ops/funnel-track");
    trackFunnelEventBg({
      userId,
      platformUserId: String(chatId),
      eventKey: "system.drip.6h",
      surface: "system",
    });
  }
}

let funnelPollBusy = false;
let lastFunnelPollAt = 0;

/** Catch missed auto-rules timers (process restart / cold start). */
export async function pollAutoRules(limit = 40): Promise<void> {
  const { maybeSendAutoRules } = await import("@/lib/tg/onboarding-flow");
  const accounts = await prisma.platformAccount.findMany({
    where: { platform: "telegram", chatState: "awaiting_rules" },
    select: {
      platformUserId: true,
      userId: true,
      pendingJson: true,
      user: { select: { ageConfirmed: true } },
    },
    take: limit,
  });
  for (const a of accounts) {
    if (a.user.ageConfirmed) continue;
    let pending: { rulesAutoAt?: number; rulesAutoSent?: boolean } = {};
    try {
      pending = JSON.parse(a.pendingJson || "{}") as typeof pending;
    } catch {
      continue;
    }
    if (pending.rulesAutoSent) continue;
    if (!pending.rulesAutoAt || pending.rulesAutoAt > Date.now()) continue;
    const chatId = Number(a.platformUserId);
    if (!Number.isFinite(chatId)) continue;
    try {
      await maybeSendAutoRules(chatId, a.userId);
    } catch (e) {
      console.error("[tg-auto-rules]", a.userId, e);
    }
  }
}

/** Background: push due drips without waiting for user to open chat. */
export async function pollTgFunnelDrips(limit = 25): Promise<void> {
  if (funnelPollBusy) return;
  if (Date.now() - lastFunnelPollAt < 15_000) return;
  funnelPollBusy = true;
  lastFunnelPollAt = Date.now();
  try {
    await pollAutoRules(Math.min(40, limit));
    const now = new Date();
    const due5 = new Date(now.getTime() - MS_5M);
    const users = await prisma.user.findMany({
      where: {
        tgFunnelAnchorAt: { not: null, lte: due5 },
        OR: [
          { tgFunnel5mSent: false },
          { tgFunnel10mIdleSent: false },
          { tgFunnel40mSent: false },
          { tgFunnel6hSent: false },
        ],
      },
      select: { id: true },
      take: limit,
      orderBy: { tgFunnelAnchorAt: "asc" },
    });

    for (const u of users) {
      const acc = await prisma.platformAccount.findFirst({
        where: { userId: u.id, platform: "telegram" },
        select: { platformUserId: true },
      });
      if (!acc) continue;
      const chatId = Number(acc.platformUserId);
      if (!Number.isFinite(chatId)) continue;
      try {
        await maybeSendFunnelDrips(chatId, u.id);
      } catch (e) {
        console.error("[tg-funnel-poll]", u.id, e);
      }
    }

    // Idle winbacks 3d / 7d — only users with an activity clock already set.
    const due3 = new Date(now.getTime() - MS_3D);
    const idleUsers = await prisma.user.findMany({
      where: {
        ageConfirmed: true,
        tgLastActiveAt: { not: null, lte: due3 },
        OR: [{ tgIdle3dSent: false }, { tgIdle7dSent: false }],
      },
      select: { id: true },
      take: limit,
      orderBy: { tgLastActiveAt: "asc" },
    });
    for (const u of idleUsers) {
      const acc = await prisma.platformAccount.findFirst({
        where: { userId: u.id, platform: "telegram" },
        select: { platformUserId: true },
      });
      if (!acc) continue;
      const chatId = Number(acc.platformUserId);
      if (!Number.isFinite(chatId)) continue;
      try {
        await maybeSendIdleWinbacks(chatId, u.id);
      } catch (e) {
        console.error("[tg-idle-poll]", u.id, e);
      }
    }

    // Seed activity clock for confirmed users missing it (db push doesn't run SQL UPDATE).
    await prisma.user.updateMany({
      where: { ageConfirmed: true, tgLastActiveAt: null },
      data: { tgLastActiveAt: now },
    });
  } finally {
    funnelPollBusy = false;
  }
}
