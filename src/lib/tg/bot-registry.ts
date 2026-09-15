import { prisma } from "@/lib/db";
import { decryptBotToken, encryptBotToken } from "@/lib/tg/bot-secrets";

export type BotRuntimeStatus = "active" | "standby";

export type LiveBot = {
  id: string;
  username: string;
  telegramBotId: string;
  token: string;
  isPrimary: boolean;
  fromEnv: boolean;
  /** active = full studio; standby = reserve /start-only */
  status: BotRuntimeStatus;
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

function mapLiveRow(
  row: {
    id: string;
    username: string;
    telegramBotId: string;
    tokenEnc: string;
    isPrimary: boolean;
    status: string;
  },
  token: string,
  fromEnv: boolean,
): LiveBot | null {
  if (row.status !== "active" && row.status !== "standby") return null;
  if (!token) return null;
  return {
    id: row.id,
    username: row.username,
    telegramBotId: row.telegramBotId,
    token,
    isPrimary: row.isPrimary,
    fromEnv,
    status: row.status,
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

async function collectBots(
  statuses: BotRuntimeStatus[],
): Promise<LiveBot[]> {
  await ensurePrimaryBotFromEnv().catch(() => undefined);
  const rows = await prisma.botInstance.findMany({
    where: { status: { in: statuses } },
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
    const mapped = mapLiveRow(row, token, fromEnv);
    if (mapped) out.push(mapped);
  }

  // Env-only fallback if DB empty / no decryptable tokens
  if (!out.length && env && statuses.includes("active")) {
    out.push({
      id: "env-primary",
      username: "env",
      telegramBotId: "",
      token: env,
      isPrimary: true,
      fromEnv: true,
      status: "active",
    });
  }
  return out;
}

/** Fully working bots (studio + mini app + outbox). */
export async function listLiveBots(): Promise<LiveBot[]> {
  return collectBots(["active"]);
}

/** Polling list: active + reserve standby (standby only answers /start). */
export async function listPollableBots(): Promise<LiveBot[]> {
  return collectBots(["active", "standby"]);
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
  // Standby must not receive outbox / generation pushes.
  if (!row || row.status !== "active") return null;
  const dec = decryptBotToken(row.tokenEnc);
  if (dec) return dec;
  if (row.isPrimary) return envToken() || null;
  return null;
}

export async function getBotInstanceStatus(
  id: string | null | undefined,
): Promise<BotRuntimeStatus | "retired" | "banned" | null> {
  if (!id || id === "env-primary") return "active";
  const row = await prisma.botInstance.findUnique({
    where: { id },
    select: { status: true },
  });
  if (!row) return null;
  if (
    row.status === "active" ||
    row.status === "standby" ||
    row.status === "retired" ||
    row.status === "banned"
  ) {
    return row.status;
  }
  return null;
}

export async function addDualBot(opts: {
  token: string;
  notes?: string;
  makePrimary?: boolean;
  /** Default active. Use standby for silent reserve mirror. */
  status?: BotRuntimeStatus;
}) {
  const token = opts.token.trim();
  if (!/^\d+:[A-Za-z0-9_-]{20,}$/.test(token)) {
    throw new Error("Не похоже на токен BotFather (вид: 123456:AA…)");
  }
  const me = await telegramGetMe(token);
  if (!me.username) throw new Error("У бота нет username в BotFather");

  const status: BotRuntimeStatus =
    opts.status === "standby" ? "standby" : "active";
  if (opts.makePrimary && status === "standby") {
    throw new Error("Резервный (неактивный) бот нельзя сделать primary");
  }

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
    if (existing.isPrimary && status === "standby") {
      throw new Error(
        "Primary нельзя сделать резервом — сначала назначьте другого primary",
      );
    }
    const row = await prisma.botInstance.update({
      where: { id: existing.id },
      data: {
        username: me.username,
        telegramBotId: me.telegramBotId,
        tokenEnc: encryptBotToken(token),
        status,
        retiredAt: null,
        isPrimary: opts.makePrimary ? true : existing.isPrimary,
        notes: opts.notes?.slice(0, 1000) ?? existing.notes,
        activatedAt: new Date(),
      },
    });
    return {
      row,
      created: false,
      message:
        status === "standby"
          ? `Бот @${me.username} сохранён как неактивный резерв. На /start — только пояснение, без рассылок.`
          : `Бот @${me.username} обновлён и активен (dual). Старый primary не остановлен.`,
    };
  }

  const row = await prisma.botInstance.create({
    data: {
      username: me.username,
      telegramBotId: me.telegramBotId,
      tokenEnc: encryptBotToken(token),
      status,
      isPrimary: Boolean(opts.makePrimary),
      notes:
        opts.notes?.slice(0, 1000) ||
        (status === "standby" ? "reserve standby" : "dual bot"),
    },
  });
  return {
    row,
    created: true,
    message:
      status === "standby"
        ? `Бот @${me.username} добавлен как неактивный резерв. Пользователи видят только текст про запасной бот.`
        : `Бот @${me.username} добавлен в dual-режим. Пользователи и данные общие; polling подхватит после рестарта процесса бота.`,
  };
}

export async function setPrimaryBot(id: string) {
  const row = await prisma.botInstance.findUnique({ where: { id } });
  if (!row) throw new Error("Бот не найден");
  if (row.status === "standby") {
    throw new Error("Сначала переведите бота в «Активный»");
  }
  if (row.status !== "active") throw new Error("Сначала верните бота в active");
  await prisma.botInstance.updateMany({
    where: { isPrimary: true },
    data: { isPrimary: false },
  });
  return prisma.botInstance.update({
    where: { id },
    data: { isPrimary: true, status: "active", activatedAt: new Date() },
  });
}

/** Toggle active ↔ standby (reserve). Primary cannot be standby. */
export async function setBotRuntimeStatus(
  id: string,
  status: BotRuntimeStatus,
) {
  const row = await prisma.botInstance.findUnique({ where: { id } });
  if (!row) throw new Error("Бот не найден");
  if (status === "standby" && row.isPrimary) {
    throw new Error(
      "Primary нельзя сделать неактивным — сначала назначьте другого primary",
    );
  }
  if (row.status === "retired" || row.status === "banned") {
    throw new Error("Сначала верните бота из retired (добавьте dual снова)");
  }
  return prisma.botInstance.update({
    where: { id },
    data: {
      status,
      retiredAt: null,
      activatedAt: status === "active" ? new Date() : row.activatedAt,
    },
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
    data: { status: "retired", isPrimary: false, retiredAt: new Date() },
  });
}

export { telegramGetMe };
