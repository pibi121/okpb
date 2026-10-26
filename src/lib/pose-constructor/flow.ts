import fs from "node:fs";
import { prisma } from "@/lib/db";
import { saveGalleryBinary, resolveGalleryFile } from "@/lib/local-store";
import type { TgLocale } from "@/lib/tg/i18n";
import { formatRubOnly } from "@/lib/tg/funnel-v2/money";
import { debitFunnelBalance } from "@/lib/tg/funnel-v2/mode";
import { FV2 } from "@/lib/tg/funnel-v2/callbacks";
import {
  getTgSession,
  parsePending,
  setTgSession,
} from "@/lib/tg/session";
import {
  tgEditMessageText,
  tgSendMessage,
  tgSendPhotoFile,
} from "@/lib/tg/telegram-api";
import {
  POSE_DEFS,
  poseById,
  poseOrderPrice,
} from "@/lib/pose-constructor/catalog";
import { startPoseFilm } from "@/lib/pose-constructor/run";

const INTRO =
  "Собери свой п@рно ролик с ней и собой в разных позах!\n\n" +
  "Просто отметь ✅ кнопки с названием поз и действий, которые хочешь видеть. После этого нажми: \"Подтвердить 🔥\" отправь фотографию любой девушки и по желанию, можешь отправить свою фотографию.\n\n" +
  "Дальше бот сгенерирует тебе готовое 🔞 видео с этими позами";

function menuButton() {
  return [{ text: "В главное меню", callback_data: FV2.hub }];
}

function poseKeyboard(selected: string[]) {
  const rows: Array<Array<Record<string, string>>> = [];
  for (let i = 0; i < POSE_DEFS.length; i += 2) {
    const pair = POSE_DEFS.slice(i, i + 2).map((pose) => ({
      text: `${selected.includes(pose.id) ? "✅ " : ""}${pose.title}`,
      callback_data: `fv2:pz:t:${pose.id}`,
    }));
    rows.push(pair);
  }
  rows.push([
    { text: "Подтвердить 🔥", callback_data: "fv2:pz:ok", style: "success" },
  ]);
  rows.push(menuButton());
  return { inline_keyboard: rows };
}

function poseText(selected: string[]): string {
  if (!selected.length) return INTRO;
  const lines = selected.map((id, i) => `${i + 1}. ${poseById(id)?.title || id}`);
  const quote = poseOrderPrice(selected);
  return (
    `${INTRO}\n\n<blockquote>Порядок выбранных поз:\n${lines.join("\n")}\n` +
    `Стоимость полного видео ${quote.sec} сек. с этими сценами = ${formatRubOnly(quote.rub)}</blockquote>`
  );
}

async function selectedIds(platformUserId: string): Promise<string[]> {
  const session = await getTgSession(platformUserId);
  const pending = parsePending(session?.pendingJson || "{}");
  return (pending.poseIds || []).filter((id) => poseById(id));
}

export async function handlePoseBuilderCallback(opts: {
  chatId: number;
  userId: string;
  platformUserId: string;
  locale: TgLocale;
  data: string;
  messageId?: number;
}): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: opts.userId },
    select: { tgPoseBuilderOk: true },
  });
  if (!user?.tgPoseBuilderOk) {
    await tgSendMessage(opts.chatId, "Конструктор сцен для этого аккаунта выключен.");
    return;
  }

  if (opts.data === FV2.pose) {
    await setTgSession(opts.platformUserId, {
      chatState: "idle",
      pending: { poseIds: [], poseManKey: "", poseRunning: false },
    });
    const sent = (await tgSendMessage(opts.chatId, poseText([]), {
      reply_markup: poseKeyboard([]),
    })) as { message_id?: number };
    if (sent?.message_id) {
      await setTgSession(opts.platformUserId, {
        pending: { poseMsgId: sent.message_id },
      });
    }
    return;
  }

  const toggle = /^fv2:pz:t:([a-z0-9_]+)$/.exec(opts.data);
  if (toggle) {
    const id = toggle[1] || "";
    if (!poseById(id)) return;
    const cur = await selectedIds(opts.platformUserId);
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
    await setTgSession(opts.platformUserId, { pending: { poseIds: next } });
    const session = await getTgSession(opts.platformUserId);
    const msgId =
      opts.messageId || parsePending(session?.pendingJson || "{}").poseMsgId;
    if (msgId) {
      try {
        await tgEditMessageText(opts.chatId, msgId, poseText(next), {
          reply_markup: poseKeyboard(next),
        });
      } catch {
        /* unchanged message */
      }
    }
    return;
  }

  if (opts.data === "fv2:pz:ok") {
    const ids = await selectedIds(opts.platformUserId);
    if (!ids.length) {
      await tgSendMessage(opts.chatId, "Сначала отметь хотя бы одну позу.");
      return;
    }
    await setTgSession(opts.platformUserId, {
      chatState: "funnel_v2_pose_girl",
    });
    await askGirl(opts.chatId, opts.platformUserId);
    return;
  }

  if (opts.data === "fv2:pz:gn") {
    const session = await getTgSession(opts.platformUserId);
    const key = parsePending(session?.pendingJson || "{}").funnelV2PhotoKey;
    if (!key) {
      await tgSendMessage(opts.chatId, "Сначала пришли фотографию девушки.");
      return;
    }
    await setTgSession(opts.platformUserId, {
      chatState: "funnel_v2_pose_man",
    });
    await askMan(opts.chatId, opts.platformUserId);
    return;
  }

  if (opts.data === "fv2:pz:ms" || opts.data === "fv2:pz:go") {
    const session = await getTgSession(opts.platformUserId);
    const manKey = parsePending(session?.pendingJson || "{}").poseManKey;
    await launch(
      opts.chatId,
      opts.userId,
      opts.platformUserId,
      opts.data === "fv2:pz:go" ? manKey || undefined : undefined,
    );
  }
}

async function askGirl(chatId: number, platformUserId: string) {
  const session = await getTgSession(platformUserId);
  const key = parsePending(session?.pendingJson || "{}").funnelV2PhotoKey;
  const markup = {
    reply_markup: {
      inline_keyboard: [
        ...(key
          ? [[{ text: "Дальше", callback_data: "fv2:pz:gn", style: "success" }]]
          : []),
        menuButton(),
      ],
    },
  };
  if (!key) {
    await tgSendMessage(
      chatId,
      "Пришли фотографию девушки. Она встанет на первое место во всех выбранных сценах.",
      markup,
    );
    return;
  }
  const abs = resolveGalleryFile(key);
  if (!abs || !fs.existsSync(abs)) {
    await tgSendMessage(
      chatId,
      "Прошлое фото не нашлось. Пришли фотографию девушки ещё раз.",
      markup,
    );
    return;
  }
  await tgSendPhotoFile(
    chatId,
    fs.readFileSync(abs),
    "girl.jpg",
    "Это последнее фото девушки. Можно заменить — просто пришли новое. Или жми «Дальше».",
    markup,
  );
}

async function askMan(chatId: number, platformUserId: string) {
  const session = await getTgSession(platformUserId);
  const key = (parsePending(session?.pendingJson || "{}").poseManKey || "").trim();
  const abs = key ? resolveGalleryFile(key) : null;
  const hasMan = Boolean(abs && fs.existsSync(abs));
  const markup = {
    reply_markup: {
      inline_keyboard: [
        [
          hasMan
            ? {
                text: "Собрать видео 🔥",
                callback_data: "fv2:pz:go",
                style: "success",
              }
            : {
                text: "Оставить как есть",
                callback_data: "fv2:pz:ms",
                style: "success",
              },
        ],
        menuButton(),
      ],
    },
  };
  if (!hasMan || !abs) {
    await tgSendMessage(
      chatId,
      "По желанию пришли своё фото. Если не пришлёшь, в сценах останется мужчина из шаблона.",
      markup,
    );
    return;
  }
  await tgSendPhotoFile(
    chatId,
    fs.readFileSync(abs),
    "man.jpg",
    "Это фото мужчины для всех выбранных сцен. Можно заменить — просто пришли другое. Или жми «Собрать видео».",
    markup,
  );
}

export async function handlePoseBuilderPhoto(opts: {
  chatId: number;
  userId: string;
  platformUserId: string;
  locale: TgLocale;
  photoBytes: Buffer;
  which: "girl" | "man";
}): Promise<void> {
  try {
    const { assertImageAllowedForGeneration } = await import("@/lib/age-gate");
    await assertImageAllowedForGeneration(opts.photoBytes, opts.locale, {
      userId: opts.userId,
    });
  } catch (e) {
    const { AgeGateBlockedError, AgeGateUncertainError } = await import(
      "@/lib/age-gate"
    );
    if (e instanceof AgeGateBlockedError || e instanceof AgeGateUncertainError) {
      await tgSendMessage(opts.chatId, e.message);
      return;
    }
    throw e;
  }

  const saved = saveGalleryBinary(
    opts.userId,
    "jpg",
    opts.photoBytes,
    opts.which === "man" ? "pose_man" : "fv2_ref",
  );

  if (opts.which === "girl") {
    await setTgSession(opts.platformUserId, {
      chatState: "funnel_v2_pose_girl",
      pending: {
        funnelV2PhotoUrl: saved.publicUrl,
        funnelV2PhotoKey: saved.relKey,
      },
    });
    await tgSendMessage(opts.chatId, "Фото девушки сохранено ✅");
    await askGirl(opts.chatId, opts.platformUserId);
    return;
  }

  await setTgSession(opts.platformUserId, {
    chatState: "funnel_v2_pose_man",
    pending: { poseManKey: saved.relKey },
  });
  await tgSendMessage(opts.chatId, "Фото мужчины сохранено ✅");
  await askMan(opts.chatId, opts.platformUserId);
}

async function launch(
  chatId: number,
  userId: string,
  platformUserId: string,
  manKey: string | undefined,
) {
  const ids = await selectedIds(platformUserId);
  if (!ids.length) {
    await tgSendMessage(chatId, "Список поз пуст. Открой конструктор ещё раз.");
    return;
  }
  const session = await getTgSession(platformUserId);
  const pending = parsePending(session?.pendingJson || "{}");
  if (pending.poseRunning) return;
  const girlKey = pending.funnelV2PhotoKey;
  if (!girlKey) {
    await tgSendMessage(chatId, "Нет фото девушки. Пришли его ещё раз.");
    return;
  }
  const quote = poseOrderPrice(ids);
  const paid = await debitFunnelBalance(userId, quote.rub);
  if (!paid.ok) {
    await tgSendMessage(
      chatId,
      `Не хватает денег. Нужно ${formatRubOnly(quote.rub)}, на балансе ${formatRubOnly(paid.balance)}.`,
    );
    return;
  }
  await setTgSession(platformUserId, {
    chatState: "idle",
    pending: { poseRunning: true },
  });
  void startPoseFilm({
    chatId,
    userId,
    poseIds: ids,
    girlKey,
    manKey,
  });
}
