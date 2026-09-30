/**
 * Funnel v2 post-blur / unblur helpers + blur nudges.
 * Faststart CTA after rules was removed — after rules always goes to hub.
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

/**
 * Stale faststart CTA buttons still in old chats → hub / photo hub.
 * Unblur (`fv2:ub:…`) lives here too.
 */
export async function handleFunnelV2FaststartCallback(opts: {
  chatId: number;
  userId: string;
  platformUserId: string;
  locale: TgLocale;
  data: string;
}): Promise<boolean> {
  if (opts.data === FV2.fsLater) {
    await cancelFunnelV2FaststartIdle(opts.userId);
    const { sendFunnelV2Hub } = await import("@/lib/tg/funnel-v2/hub");
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

/** Legacy: cancel idle faststart nudge (field reused as soft 30m hub nudge). */
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
        // Soft 30m «Я могу сгенерировать…» uses this legacy flag.
        tgFunnelV2FaststartNudgeSent: false,
        tgFunnelV2FaststartAt: null,
      },
    })
    .catch(() => undefined);
}

export async function cancelFunnelV2BlurNudge(userId: string) {
  await prisma.user
    .update({
      where: { id: userId },
      data: {
        tgFunnelV2BlurNudgeSent: true,
        tgFunnelV2FaststartNudgeSent: true,
      },
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
      const { sendFunnelV2Hub } = await import("@/lib/tg/funnel-v2/hub");
      await sendFunnelV2Hub(chatId, opts.userId, locale);
    }
  }
}

const MS_10M = 10 * 60_000;
const MS_30M = 30 * 60_000;

function isDeadTelegramChat(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /bot was blocked|chat not found|user is deactivated|Forbidden: bot|PEER_ID_INVALID/i.test(
    msg,
  );
}

/**
 * Polled from funnel drip:
 * - 10m after blur, no topup → resend blur + «Она тебя ждёт!»
 * - 30m after blur, no topup → soft «Я могу сгенерировать…» + hub button
 */
export async function pollFunnelV2FaststartNudges(limit = 40): Promise<void> {
  const now = Date.now();
  const due10 = new Date(now - MS_10M);
  const due30 = new Date(now - MS_30M);

  const blurUsers = await prisma.user.findMany({
    where: {
      tgFunnelV2BlurOfferAt: { not: null, lte: due10 },
      OR: [
        { tgFunnelV2BlurNudgeSent: false },
        {
          tgFunnelV2BlurOfferAt: { lte: due30 },
          tgFunnelV2FaststartNudgeSent: false,
        },
      ],
    },
    select: {
      id: true,
      balancePeaches: true,
      tgFunnelV2Preview: true,
      tgFunnelV2PreviewBalance: true,
      tgFunnelV2BlurOfferAt: true,
      tgFunnelV2BlurNudgeSent: true,
      tgFunnelV2FaststartNudgeSent: true,
    },
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

    const offerAt = u.tgFunnelV2BlurOfferAt?.getTime() ?? 0;
    const needHard = !u.tgFunnelV2BlurNudgeSent && offerAt <= now - MS_10M;
    const needSoft =
      !u.tgFunnelV2FaststartNudgeSent && offerAt <= now - MS_30M;

    if (!needHard && !needSoft) continue;

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

    try {
      if (needHard) {
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
      }

      if (needSoft) {
        const softText =
          `Я могу сгенерировать по её фотографии любые фото, видео, фильмы, ` +
          `и заставить её сделать всё, что ты захочешь. ` +
          `Перейди в главное меню, чтобы узнать больше`;
        await tgSendMessage(chatId, softText, {
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: "⬅️ Открыть главное меню",
                  callback_data: FV2.hub,
                  style: "primary",
                },
              ],
            ],
          },
        });
        await prisma.user.update({
          where: { id: u.id },
          data: { tgFunnelV2FaststartNudgeSent: true },
        });
      }
    } catch (e) {
      if (isDeadTelegramChat(e)) await cancelFunnelV2BlurNudge(u.id);
      else console.error("[fv2-blur-nudge]", u.id, e);
    }
  }
}
