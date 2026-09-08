import { prisma } from "@/lib/db";
import { decryptBotToken, encryptBotToken } from "@/lib/tg/bot-secrets";

export type LiveBot = {
  id: string;
  username: string;
  telegramBotId: string;
  token: string;
  isPrimary: boolean;
  fromEnv: boolean;
};

function envToken() {
  return process.env.TELEGRAM_BOT_TOKEN?.trim() || "";
}

async function telegramGetMe(token: string) {
  const res = await fetch(`https://api.telegram.org/bot${token}/getMe`, {
    method: "GET",
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
  });
  const json = (await res.json()) as {
    ok?: boolean;
    description?: string;
    result?: { id?: number; username?: string; first_name?: string };
  };
  if (!json.ok || !json.result?.id) {
    throw new Error(json.description || "Telegram getMe failed");
  }
  return {
    telegramBotId: String(json.result.id),
    username: String(json.result.username || "").replace(/^@/, ""),
    firstName: json.result.first_name || "",
  };
}

/** Ensure env primary exists as a BotInstance row (token may stay in env only). */
export async function ensurePrimaryBotFromEnv() {
  const token = envToken();
  const existingPrimary = await prisma.botInstance.findFirst({
    where: { isPrimary: true, status: "active" },
  });
  if (existingPrimary) return existingPrimary;

  let username =
    process.env.TELEGRAM_BOT_PUBLIC_URL?.match(/t\.me\/([A-Za-z0-9_]+)/)?.[1] ||
    "peachbibot";
  let telegramBotId = "";

  if (token) {
    try {
      const me = await telegramGetMe(token);
      username = me.username || username;
      telegramBotId = me.telegramBotId;
    } catch {
      /* keep fallback username */
    }
  }

  const byName = await prisma.botInstance.findFirst({
    where: { username },
    orderBy: { activatedAt: "desc" },
  });
  if (byName) {
    return prisma.botInstance.update({
      where: { id: byName.id },
      data: {
        isPrimary: true,
        status: "active",
        telegramBotId: telegramBotId || byName.telegramBotId,
        retiredAt: null,
      },
    });
  }

  return prisma.botInstance.create({
    data: {
      username,
      telegramBotId,
      isPrimary: true,
      status: "active",
      tokenEnc: "", // env holds primary token
      notes: "primary from TELEGRAM_BOT_TOKEN",
    },
  });
}

export async function listLiveBots(): Promise<LiveBot[]> {
  await ensurePrimaryBotFromEnv().catch(() => undefined);
  const rows = await prisma.botInstance.findMany({
    where: { status: "active" },
    orderBy: [{ isPrimary: "desc" }, { activatedAt: "asc" }],
  });
  const out: LiveBot[] = [];
  const env = envToken();

  for (const row of rows) {
    let token = decryptBotToken(row.tokenEnc) || "";
    let fromEnv = false;
    if (!token && row.isPrimary && env) {
      token = env;
      fromEnv = true;
    }
    if (!token) continue;
    out.push({
      id: row.id,
      username: row.username,
      telegramBotId: row.telegramBotId,
      token,
      isPrimary: row.isPrimary,
      fromEnv,
    });
  }

  // Env-only fallback if DB empty / no decryptable tokens
  if (!out.length && env) {
    out.push({
      id: "env-primary",
      username: "env",
      telegramBotId: "",
      token: env,
      isPrimary: true,
      fromEnv: true,
    });
  }
  return out;
}

export async function listActiveBotTokens(): Promise<string[]> {
  const bots = await listLiveBots();
  return [...new Set(bots.map((b) => b.token))];
}

export async function resolveBotTokenByInstanceId(
  id: string | null | undefined,
): Promise<string | null> {
  if (!id) return null;
  if (id === "env-primary") return envToken() || null;
  const row = await prisma.botInstance.findUnique({ where: { id } });
  if (!row || row.status !== "active") return null;
  const dec = decryptBotToken(row.tokenEnc);
  if (dec) return dec;
  if (row.isPrimary) return envToken() || null;
  return null;
}

export async function addDualBot(opts: {
  token: string;
  notes?: string;
  makePrimary?: boolean;
}) {
  const token = opts.token.trim();
  if (!/^\d+:[A-Za-z0-9_-]{20,}$/.test(token)) {
    throw new Error("Не похоже на токен BotFather (вид: 123456:AA…)");
  }
  const me = await telegramGetMe(token);
  if (!me.username) throw new Error("У бота нет username в BotFather");

  const existing = await prisma.botInstance.findFirst({
    where: {
      OR: [
        { username: me.username },
        { telegramBotId: me.telegramBotId },
      ],
    },
  });

  await ensurePrimaryBotFromEnv();

  if (opts.makePrimary) {
    await prisma.botInstance.updateMany({
      where: { isPrimary: true },
      data: { isPrimary: false },
    });
  }

  if (existing) {
    const row = await prisma.botInstance.update({
      where: { id: existing.id },
      data: {
        username: me.username,
        telegramBotId: me.telegramBotId,
        tokenEnc: encryptBotToken(token),
        status: "active",
        retiredAt: null,
        isPrimary: opts.makePrimary ? true : existing.isPrimary,
        notes: opts.notes?.slice(0, 1000) ?? existing.notes,
        activatedAt: new Date(),
      },
    });
    return {
      row,
      created: false,
      message: `Бот @${me.username} обновлён и активен (dual). Старый primary не остановлен.`,
    };
  }

  const row = await prisma.botInstance.create({
    data: {
      username: me.username,
      telegramBotId: me.telegramBotId,
      tokenEnc: encryptBotToken(token),
      status: "active",
      isPrimary: Boolean(opts.makePrimary),
      notes: opts.notes?.slice(0, 1000) || "dual bot",
    },
  });
  return {
    row,
    created: true,
    message: `Бот @${me.username} добавлен в dual-режим. Пользователи и данные общие; polling подхватит после рестарта процесса бота.`,
  };
}

export async function setPrimaryBot(id: string) {
  const row = await prisma.botInstance.findUnique({ where: { id } });
  if (!row) throw new Error("Бот не найден");
  if (row.status !== "active") throw new Error("Сначала верните бота в active");
  await prisma.botInstance.updateMany({
    where: { isPrimary: true },
    data: { isPrimary: false },
  });
  return prisma.botInstance.update({
    where: { id },
    data: { isPrimary: true, activatedAt: new Date() },
  });
}

export async function retireBot(id: string) {
  const row = await prisma.botInstance.findUnique({ where: { id } });
  if (!row) throw new Error("Бот не найден");
  if (row.isPrimary) {
    throw new Error("Нельзя retired primary — сначала назначьте другого primary");
  }
  return prisma.botInstance.update({
    where: { id },
    data: { status: "retired", retiredAt: new Date() },
  });
}

export { telegramGetMe };
