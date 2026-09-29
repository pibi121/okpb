/**
 * Funnel v2 faststart: after rules, CTA+video instead of hub (flag-gated).
 */
import { prisma } from "@/lib/db";
import type { TgLocale } from "@/lib/tg/i18n";
import { undressPeaches } from "@/lib/tg-pricing";
import {
  getTgSession,
  parsePending,
  setTgSession,
} from "@/lib/tg/session";
import { tgSendMessage } from "@/lib/tg/telegram-api";
import { FV2 } from "@/lib/tg/funnel-v2/callbacks";
import { isFunnelV2FaststartEnabled } from "@/lib/tg/funnel-v2/mode";
import {
  attachV2ReplyKbSilent,
  sendFunnelV2Hub,
} from "@/lib/tg/funnel-v2/hub";

const PHOTO_HINT_URL =
  "https://telegra.ph/Instrukciya-kak-generirovat-foto-09-26";

export function funnelV2FaststartKeyboard() {
  return {
    inline_keyboard: [
      [
        {
          text: "🔥 Хочу выбрать позу/действие",
          callback_data: FV2.fsPose,
          style: "success",
        },
      ],
      [
        {
          text: "⬅️ Позже. Открыть меню бота",
          callback_data: FV2.fsLater,
        },
      ],
    ],
  };
}

export function buildFunnelV2FaststartText(): string {
  return (
    `Давай разденем её или заставим что-нибудь сделать?\n\n` +
    `Просто отправь мне сейчас любую фотографию девушки, которой ты хочешь насладиться. ` +
    `Главное, чтобы хорошо было видно её лицо ` +
    `(<a href="${PHOTO_HINT_URL}">вот тут подробная инструкция</a>).\n\n` +
    `И я сделаю для тебя пробную генерацию фото!`
  );
}

export async function sendFunnelV2Faststart(
  chatId: number,
  userId: string,
  _locale: TgLocale,
): Promise<void> {
  // 1) Reply keyboard first (no sticky «закреплена» left as last message).
  await attachV2ReplyKbSilent(chatId);

  await prisma.user.update({
    where: { id: userId },
    data: {
      tgFunnelV2FaststartAt: new Date(),
      tgFunnelV2FaststartNudgeSent: false,
    },
  });

  await setTgSession(String(chatId), {
    chatState: "funnel_v2_awaiting_photo",
    pending: {
      funnelV2FaststartRandom: true,
    },
  });

  const text = buildFunnelV2FaststartText();
  const markup = funnelV2FaststartKeyboard();
  const { funnelV2ReplaceUi } = await import("@/lib/tg/funnel-v2/ui");
  const { sendCoverPhoto } = await import("@/lib/tg/funnel-v2/media");
  await funnelV2ReplaceUi(String(chatId), chatId, () =>
    sendCoverPhoto(chatId, "faststart", text, markup),
  );
}

/** After rules: faststart or classic hub. */
export async function afterFunnelV2RulesAccepted(
  chatId: number,
  userId: string,
  locale: TgLocale,
): Promise<void> {
  if (isFunnelV2FaststartEnabled()) {
    await sendFunnelV2Faststart(chatId, userId, locale);
    return;
  }
  await sendFunnelV2Hub(chatId, userId, locale);
}

export async function handleFunnelV2FaststartCallback(opts: {
  chatId: number;
  userId: string;
  platformUserId: string;
  locale: TgLocale;
  data: string;
}): Promise<boolean> {
  if (opts.data === FV2.fsLater) {
    await cancelFunnelV2FaststartIdle(opts.userId);
    await sendFunnelV2Hub(opts.chatId, opts.userId, opts.locale);
    return true;
  }
  if (opts.data === FV2.fsPose) {
    await cancelFunnelV2FaststartIdle(opts.userId);
    await setTgSession(opts.platformUserId, {
      chatState: "idle",
      pending: { funnelV2FaststartRandom: false },
    });
    const { sendFunnelV2PhotoHub } = await import("@/lib/tg/funnel-v2/photo");
    await sendFunnelV2PhotoHub(
      opts.chatId,
      opts.userId,
      opts.platformUserId,
      opts.locale,
      0,
    );
    return true;
  }
  const ub = /^fv2:ub:(.+)$/.exec(opts.data);
  if (ub) {
    await beginFunnelV2UnblurTopup({
      chatId: opts.chatId,
      userId: opts.userId,
      platformUserId: opts.platformUserId,
      locale: opts.locale,
      galleryItemId: ub[1]!,
    });
    return true;
  }
  return false;
}

export async function cancelFunnelV2FaststartIdle(userId: string) {
  await prisma.user
    .update({
      where: { id: userId },
      data: { tgFunnelV2FaststartNudgeSent: true },
    })
    .catch(() => undefined);
}

export async function markFunnelV2BlurOffered(userId: string) {
  await prisma.user
    .update({
      where: { id: userId },
      data: {
        tgFunnelV2BlurOfferAt: new Date(),
        tgFunnelV2BlurNudgeSent: false,
        tgFunnelV2FaststartNudgeSent: true,
      },
    })
    .catch(() => undefined);
}

export async function cancelFunnelV2BlurNudge(userId: string) {
  await prisma.user
    .update({
      where: { id: userId },
      data: { tgFunnelV2BlurNudgeSent: true },
    })
    .catch(() => undefined);
}

async function beginFunnelV2UnblurTopup(opts: {
  chatId: number;
  userId: string;
  platformUserId: string;
  locale: TgLocale;
  galleryItemId: string;
}) {
  const item = await prisma.galleryItem.findFirst({
    where: { id: opts.galleryItemId, userId: opts.userId },
  });
  if (!item) {
    await tgSendMessage(opts.chatId, "Генерация не найдена.");
    return;
  }
  let meta: Record<string, unknown> = {};
  try {
    meta = JSON.parse(item.metaJson || "{}") as Record<string, unknown>;
  } catch {
    meta = {};
  }
  const recipe = meta.unblurRecipe as
    | {
        kind?: "ud" | "tpl";
        templateId?: string;
        photoUrl?: string;
        photoKey?: string;
        price?: number;
        poseTitle?: string;
      }
    | undefined;
  const kind = recipe?.kind === "tpl" ? "tpl" : "ud";
  const templateId = String(recipe?.templateId || "undress");
  const photoUrl = String(recipe?.photoUrl || "").trim();
  const price =
    typeof recipe?.price === "number" && recipe.price > 0
      ? recipe.price
      : kind === "ud"
        ? undressPeaches()
        : 0;
  if (!photoUrl) {
    await tgSendMessage(
      opts.chatId,
      "Не нашёл исходное фото. Открой раздел фото и сделай генерацию заново.",
    );
    return;
  }
  await setTgSession(opts.platformUserId, {
    pending: {
      funnelV2Unblur: {
        galleryItemId: opts.galleryItemId,
        kind,
        templateId,
        photoUrl,
        photoKey: recipe?.photoKey,
        price: price || undressPeaches(),
        poseTitle: String(recipe?.poseTitle || item.title || "поза"),
      },
      funnelV2ReturnHubAfterTopup: false,
    },
  });
  const { sendFunnelV2Topup } = await import("@/lib/tg/funnel-v2/topup");
  await sendFunnelV2Topup(opts.chatId, opts.userId, opts.locale);
}

/** Clear unblur intent when user opens plain topup; mark return-to-hub. */
export async function clearFunnelV2UnblurIntent(
  platformUserId: string,
  opts?: { returnHubAfterTopup?: boolean },
) {
  await setTgSession(platformUserId, {
    pending: {
      funnelV2Unblur: undefined,
      funnelV2ReturnHubAfterTopup: Boolean(opts?.returnHubAfterTopup),
    },
  });
}

/** After successful topup: unblur regen or hub. */
export async function afterFunnelV2TopupCredited(opts: {
  userId: string;
  peaches: number;
}): Promise<void> {
  await cancelFunnelV2BlurNudge(opts.userId);
  await cancelFunnelV2FaststartIdle(opts.userId);

  const acc = await prisma.platformAccount.findFirst({
    where: { userId: opts.userId, platform: "telegram" },
    orderBy: { lastSeenAt: "desc" },
  });
  if (!acc?.platformUserId) return;
  const chatId = Number(acc.platformUserId);
  if (!Number.isFinite(chatId)) return;
  const platformUserId = acc.platformUserId;
  const pending = parsePending(
    (await getTgSession(platformUserId))?.pendingJson || "{}",
  );
  const unblur = pending.funnelV2Unblur;
  const returnHub = Boolean(pending.funnelV2ReturnHubAfterTopup);
  const user = await prisma.user.findUnique({ where: { id: opts.userId } });
  const locale: TgLocale = user?.locale === "en" ? "en" : "ru";

  if (unblur?.photoUrl) {
    await setTgSession(platformUserId, {
      pending: {
        funnelV2Unblur: undefined,
        funnelV2ReturnHubAfterTopup: false,
        funnelV2PhotoUrl: unblur.photoUrl,
        funnelV2PhotoKey: unblur.photoKey,
      },
    });
    const { runFunnelV2PhotoGen } = await import("@/lib/tg/funnel-v2/photo");
    await runFunnelV2PhotoGen({
      chatId,
      userId: opts.userId,
      platformUserId,
      locale,
      kind: unblur.kind,
      templateId: unblur.templateId,
      photoUrl: unblur.photoUrl,
      forcePaid: true,
    });
    return;
  }

  if (returnHub) {
    await setTgSession(platformUserId, {
      pending: { funnelV2ReturnHubAfterTopup: false },
    });
    const { userOnFunnelV2 } = await import("@/lib/tg/funnel-v2/mode");
    if (user && (await userOnFunnelV2(user))) {
      await sendFunnelV2Hub(chatId, opts.userId, locale);
    }
  }
}

/** Random undress or published pose → blur trial. */
export async function startFunnelV2FaststartRandomGen(opts: {
  chatId: number;
  userId: string;
  platformUserId: string;
  locale: TgLocale;
  photoUrl: string;
}): Promise<void> {
  await cancelFunnelV2FaststartIdle(opts.userId);
  const tpls = await prisma.photoTemplate.findMany({
    where: { funnelV2Published: true },
    select: { id: true },
    take: 60,
  });
  type Pick = { kind: "ud" | "tpl"; id: string };
  const pool: Pick[] = [{ kind: "ud", id: "undress" }];
  for (const t of tpls) pool.push({ kind: "tpl", id: t.id });
  const pick = pool[Math.floor(Math.random() * pool.length)]!;
  const { runFunnelV2PhotoGen } = await import("@/lib/tg/funnel-v2/photo");
  await runFunnelV2PhotoGen({
    chatId: opts.chatId,
    userId: opts.userId,
    platformUserId: opts.platformUserId,
    locale: opts.locale,
    kind: pick.kind,
    templateId: pick.id,
    photoUrl: opts.photoUrl,
  });
}

const MS_30M = 30 * 60_000;

function isDeadTelegramChat(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /bot was blocked|chat not found|user is deactivated|Forbidden: bot|PEER_ID_INVALID/i.test(
    msg,
  );
}

/** Polled from funnel drip — 30m idle nudges only. */
export async function pollFunnelV2FaststartNudges(limit = 40): Promise<void> {
  if (!isFunnelV2FaststartEnabled()) return;
  const now = Date.now();
  const due = new Date(now - MS_30M);

  const idleUsers = await prisma.user.findMany({
    where: {
      tgFunnelV2FaststartAt: { not: null, lte: due },
      tgFunnelV2FaststartNudgeSent: false,
    },
    select: { id: true },
    take: limit,
    orderBy: { tgFunnelV2FaststartAt: "asc" },
  });
  for (const u of idleUsers) {
    const acc = await prisma.platformAccount.findFirst({
      where: { userId: u.id, platform: "telegram" },
      orderBy: { lastSeenAt: "desc" },
      select: { platformUserId: true, pendingJson: true, chatState: true },
    });
    if (!acc) {
      await cancelFunnelV2FaststartIdle(u.id);
      continue;
    }
    const chatId = Number(acc.platformUserId);
    if (!Number.isFinite(chatId)) continue;
    const pending = parsePending(acc.pendingJson || "{}");
    // Still waiting on faststart photo and never left.
    if (!pending.funnelV2FaststartRandom) {
      await cancelFunnelV2FaststartIdle(u.id);
      continue;
    }
    try {
      await tgSendMessage(chatId, "Ты тут? Что мне сделать?", {
        reply_markup: funnelV2FaststartKeyboard(),
      });
      await prisma.user.update({
        where: { id: u.id },
        data: { tgFunnelV2FaststartNudgeSent: true },
      });
    } catch (e) {
      if (isDeadTelegramChat(e)) await cancelFunnelV2FaststartIdle(u.id);
      else console.error("[fv2-faststart-nudge]", u.id, e);
    }
  }

  const blurUsers = await prisma.user.findMany({
    where: {
      tgFunnelV2BlurOfferAt: { not: null, lte: due },
      tgFunnelV2BlurNudgeSent: false,
    },
    select: { id: true, balancePeaches: true, tgFunnelV2Preview: true, tgFunnelV2PreviewBalance: true },
    take: limit,
    orderBy: { tgFunnelV2BlurOfferAt: "asc" },
  });
  for (const u of blurUsers) {
    const bal = u.tgFunnelV2Preview
      ? u.tgFunnelV2PreviewBalance
      : u.balancePeaches;
    if (bal > 0) {
      await cancelFunnelV2BlurNudge(u.id);
      continue;
    }
    const acc = await prisma.platformAccount.findFirst({
      where: { userId: u.id, platform: "telegram" },
      orderBy: { lastSeenAt: "desc" },
      select: { platformUserId: true },
    });
    if (!acc) {
      await cancelFunnelV2BlurNudge(u.id);
      continue;
    }
    const chatId = Number(acc.platformUserId);
    if (!Number.isFinite(chatId)) continue;

    const blurItem = await prisma.galleryItem.findFirst({
      where: {
        userId: u.id,
        metaJson: { contains: '"blurTrial":true' },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, title: true, resultUrl: true, metaJson: true },
    });

    let poseTitle = blurItem?.title || "поза";
    let price = undressPeaches();
    try {
      const meta = JSON.parse(blurItem?.metaJson || "{}") as {
        unblurRecipe?: { poseTitle?: string; price?: number };
      };
      if (meta.unblurRecipe?.poseTitle) poseTitle = meta.unblurRecipe.poseTitle;
      if (meta.unblurRecipe?.price) price = meta.unblurRecipe.price;
    } catch {
      /* ignore */
    }

    const text =
      `Она тебя ждёт!\n\n` +
      `Я сделал с ней фотографию в позе: «${poseTitle}». Получилось очень сексуально!\n\n` +
      `Чтобы снять блюр, нужно пополнить баланс 🍑\n\n` +
      `🎁 Мы начислим тебе дополнительные персики, просто в подарок. ` +
      `На них ты сможешь оживить фото, сделать фильм или сгенерировать её или кого-то другого в разных позах.`;

    const { funnelV2PhotoBlurKeyboard } = await import(
      "@/lib/tg/funnel-v2/result-keyboards"
    );
    const kb = funnelV2PhotoBlurKeyboard("ru", {
      pricePeaches: price,
      galleryItemId: blurItem?.id,
    });

    try {
      if (blurItem?.resultUrl) {
        const { tgDeliverPhoto } = await import("@/lib/tg/deliver-media");
        await tgDeliverPhoto({
          chatId,
          url: blurItem.resultUrl,
          caption: text,
          extra: { reply_markup: kb },
        });
      } else {
        await tgSendMessage(chatId, text, { reply_markup: kb });
      }
      await prisma.user.update({
        where: { id: u.id },
        data: { tgFunnelV2BlurNudgeSent: true },
      });
    } catch (e) {
      if (isDeadTelegramChat(e)) await cancelFunnelV2BlurNudge(u.id);
      else console.error("[fv2-blur-nudge]", u.id, e);
    }
  }
}
