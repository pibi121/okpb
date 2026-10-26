import { randomBytes } from "crypto";
import fs from "fs";
import path from "path";
import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import { getPrimaryBotUsername } from "@/lib/tg/bot-config";
import { dataRoot } from "@/lib/paths";

export type CabinetRole = "investor" | "buyer";

export const CABINET_WITHDRAW_MIN = 500;
export const CABINET_HOLD_MS = 3 * 24 * 60 * 60 * 1000;

export function isCabinetRole(v: string): v is CabinetRole {
  return v === "investor" || v === "buyer";
}

function randomCode(len = 8): string {
  return randomBytes(Math.ceil(len / 2))
    .toString("hex")
    .slice(0, len);
}

export function generateCabinetPassword(): string {
  return randomBytes(9).toString("base64url").slice(0, 12);
}

export function generateCabinetLogin(role: CabinetRole): string {
  return `${role === "investor" ? "i" : "b"}${randomBytes(3).toString("hex")}`;
}

function isUniqueError(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    "code" in e &&
    (e as { code?: string }).code === "P2002"
  );
}

function slugify(label: string): string {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 32);
  return slug || randomCode(6);
}

export function safeHttpUrl(raw: string): string | null {
  const s = raw.trim();
  if (!s) return "";
  let url: URL;
  try {
    url = new URL(s);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  return url.toString();
}

function bridgeOrigin(): string {
  return (process.env.PARTNER_BRIDGE_ORIGIN?.trim() || "https://pichbitch.live").replace(
    /\/$/,
    "",
  );
}

function reportsDir(): string {
  const dir = path.join(dataRoot(), "cabinet-reports");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function cabinetReportPath(fileName: string): string | null {
  const safe = fileName.replace(/[^a-zA-Z0-9._-]/g, "");
  if (!safe || safe !== fileName) return null;
  const root = reportsDir();
  const abs = path.join(root, safe);
  if (!abs.startsWith(root)) return null;
  return abs;
}

function personName(p: { name: string; login: string }): string {
  return p.name.trim() || p.login;
}

function mineOf(
  role: string,
  row: { investorPeaches: number; buyerPeaches: number },
): number {
  return role === "investor" ? row.investorPeaches : row.buyerPeaches;
}

export async function createCabinetAccount(opts: {
  role: CabinetRole;
  name: string;
  login?: string;
  password?: string;
}) {
  const name = opts.name.trim().slice(0, 80);
  if (!name) throw new Error("Нужно имя");
  const password = opts.password || generateCabinetPassword();
  const passwordHash = await hashPassword(password);

  for (let i = 0; i < 8; i++) {
    const login = (opts.login || generateCabinetLogin(opts.role)).trim().toLowerCase();
    if (!/^[a-z0-9._-]{3,32}$/.test(login)) {
      throw new Error("Логин: 3–32 символа, латиница, цифры, точка, _ или -");
    }
    try {
      const account = await prisma.cabinetAccount.create({
        data: { login, passwordHash, role: opts.role, name },
      });
      return { account, password };
    } catch (e) {
      if (!isUniqueError(e) || opts.login) {
        if (isUniqueError(e)) throw new Error("Такой логин уже есть");
        throw e;
      }
    }
  }
  throw new Error("Не удалось создать логин");
}

export async function resetCabinetPassword(accountId: string) {
  const password = generateCabinetPassword();
  const passwordHash = await hashPassword(password);
  const account = await prisma.cabinetAccount.update({
    where: { id: accountId },
    data: { passwordHash },
  });
  return { account, password };
}

export async function createCabinetProject(opts: {
  investorId: string;
  buyerId: string;
  chatUrl?: string;
}) {
  const investor = await prisma.cabinetAccount.findUnique({ where: { id: opts.investorId } });
  const buyer = await prisma.cabinetAccount.findUnique({ where: { id: opts.buyerId } });
  if (!investor || investor.role !== "investor") throw new Error("Выберите инвестора");
  if (!buyer || buyer.role !== "buyer") throw new Error("Выберите байера");
  const chatUrl = safeHttpUrl(opts.chatUrl || "");
  if (chatUrl === null) throw new Error("Ссылка на чат должна начинаться с http:// или https://");

  for (let i = 0; i < 6; i++) {
    try {
      return await prisma.cabinetProject.create({
        data: {
          code: randomCode(8),
          investorId: investor.id,
          buyerId: buyer.id,
          chatUrl,
        },
      });
    } catch (e) {
      if (!isUniqueError(e)) throw e;
      const again = await prisma.cabinetProject.findUnique({
        where: { investorId_buyerId: { investorId: investor.id, buyerId: buyer.id } },
      });
      if (again) throw new Error("Такая связка уже есть");
    }
  }
  throw new Error("Не удалось создать связку");
}

export async function updateCabinetProject(opts: {
  id: string;
  investorPct: number;
  buyerPct: number;
  chatUrl: string;
}) {
  const investorPct = Math.round(opts.investorPct);
  const buyerPct = Math.round(opts.buyerPct);
  if (![investorPct, buyerPct].every((n) => Number.isFinite(n) && n >= 0 && n <= 100)) {
    throw new Error("Доли: целые числа от 0 до 100");
  }
  const chatUrl = safeHttpUrl(opts.chatUrl);
  if (chatUrl === null) throw new Error("Ссылка на чат должна начинаться с http:// или https://");
  return prisma.cabinetProject.update({
    where: { id: opts.id },
    data: { investorPct, buyerPct, chatUrl },
  });
}

async function projectFor(accountId: string, projectId: string) {
  const project = await prisma.cabinetProject.findUnique({
    where: { id: projectId },
    include: {
      investor: { select: { id: true, name: true, login: true, role: true } },
      buyer: { select: { id: true, name: true, login: true, role: true } },
    },
  });
  if (!project) throw new Error("Проект не найден");
  if (project.investorId !== accountId && project.buyerId !== accountId) {
    throw new Error("Нет доступа к этому проекту");
  }
  return project;
}

export async function createCabinetLink(accountId: string, projectId: string, label: string) {
  const project = await projectFor(accountId, projectId);
  if (project.buyerId !== accountId) throw new Error("Ссылки создаёт байер");
  const clean = label.trim().slice(0, 80);
  if (!clean) throw new Error("Напиши название ссылки");
  let slug = slugify(clean);
  for (let i = 0; i < 5; i++) {
    try {
      return await prisma.cabinetLink.create({
        data: { projectId: project.id, slug, label: clean },
      });
    } catch (e) {
      if (!isUniqueError(e)) throw e;
      slug = `${slugify(clean).slice(0, 20)}_${randomCode(4)}`;
    }
  }
  throw new Error("Не удалось создать ссылку");
}

export async function createCabinetSpend(accountId: string, projectId: string, amountRub: number) {
  const project = await projectFor(accountId, projectId);
  if (project.investorId !== accountId) throw new Error("Сумму записывает инвестор");
  const amount = Math.floor(amountRub);
  if (!Number.isFinite(amount) || amount < 1 || amount > 100_000_000) {
    throw new Error("Сумма: целое число от 1");
  }
  return prisma.cabinetSpend.create({
    data: { projectId: project.id, amountRub: amount },
  });
}

export async function saveCabinetReport(opts: {
  accountId: string;
  projectId: string;
  spendId: string;
  title: string;
  body: string;
  file?: { bytes: Buffer; ext: string } | null;
}) {
  const project = await projectFor(opts.accountId, opts.projectId);
  if (project.buyerId !== opts.accountId) throw new Error("Отчёт прикрепляет байер");
  const spend = await prisma.cabinetSpend.findFirst({
    where: { id: opts.spendId, projectId: project.id },
  });
  if (!spend) throw new Error("Заявка не найдена");
  const title = opts.title.trim().slice(0, 120);
  const body = opts.body.trim().slice(0, 2000);
  if (!title) throw new Error("Напиши, куда ушли деньги");
  if (!body) throw new Error("Добавь короткое описание");

  let reportFile = spend.reportFile;
  if (opts.file) {
    const ext = opts.file.ext.toLowerCase().replace(/^\./, "");
    if (!["jpg", "jpeg", "png", "webp"].includes(ext)) {
      throw new Error("Скрин: jpg, png или webp");
    }
    if (opts.file.bytes.length > 4 * 1024 * 1024) throw new Error("Скрин больше 4 МБ");
    const name = `${spend.id}.${ext === "jpeg" ? "jpg" : ext}`;
    const abs = cabinetReportPath(name);
    if (!abs) throw new Error("Не удалось сохранить скрин");
    fs.writeFileSync(abs, opts.file.bytes);
    if (reportFile && reportFile !== name) {
      const prev = cabinetReportPath(reportFile);
      if (prev && fs.existsSync(prev)) fs.unlinkSync(prev);
    }
    reportFile = name;
  }

  return prisma.cabinetSpend.update({
    where: { id: spend.id },
    data: { reportTitle: title, reportBody: body, reportFile, reportedAt: new Date() },
  });
}

/** Ops: book a top-up on a deal link and split it by the current rates. */
export async function creditCabinetTopup(opts: {
  linkId: string;
  gross: number;
  mature?: boolean;
}) {
  const gross = Math.floor(opts.gross);
  if (!Number.isFinite(gross) || gross < 1) throw new Error("Сумма пополнения: целое число от 1");
  const link = await prisma.cabinetLink.findUnique({
    where: { id: opts.linkId },
    include: {
      project: {
        include: {
          investor: { select: { name: true, login: true } },
          buyer: { select: { name: true, login: true } },
        },
      },
    },
  });
  if (!link) throw new Error("Ссылка не найдена");
  const investorPeaches = Math.floor((gross * link.project.investorPct) / 100);
  const buyerPeaches = Math.floor((gross * link.project.buyerPct) / 100);
  const createdAt = opts.mature
    ? new Date(Date.now() - CABINET_HOLD_MS - 60 * 60 * 1000)
    : new Date();

  await prisma.$transaction(async (tx) => {
    await tx.cabinetAccrual.create({
      data: {
        projectId: link.projectId,
        linkId: link.id,
        grossPeaches: gross,
        investorPeaches,
        buyerPeaches,
        investorPct: link.project.investorPct,
        buyerPct: link.project.buyerPct,
        createdAt,
      },
    });
    await tx.cabinetLink.update({
      where: { id: link.id },
      data: {
        purchases: { increment: 1 },
        purchaseGrossPeaches: { increment: gross },
      },
    });
    if (investorPeaches > 0) {
      await tx.cabinetAccount.update({
        where: { id: link.project.investorId },
        data: {
          balancePeaches: { increment: investorPeaches },
          totalEarnedPeaches: { increment: investorPeaches },
        },
      });
    }
    if (buyerPeaches > 0) {
      await tx.cabinetAccount.update({
        where: { id: link.project.buyerId },
        data: {
          balancePeaches: { increment: buyerPeaches },
          totalEarnedPeaches: { increment: buyerPeaches },
        },
      });
    }
  });

  void notifyCabinetPayments({
    title: "💼 <b>Начисление по сделке</b>",
    note: "Вручную из админки. Это не оплата пользователя.",
    investorName: personName(link.project.investor),
    buyerName: personName(link.project.buyer),
    investorPeaches,
    buyerPeaches,
    investorPct: link.project.investorPct,
    buyerPct: link.project.buyerPct,
    gross,
    linkLabel: link.label || link.slug,
  });

  return { gross, investorPeaches, buyerPeaches };
}

export async function cabinetAvailability(account: {
  id: string;
  role: string;
  balancePeaches: number;
}) {
  const since = new Date(Date.now() - CABINET_HOLD_MS);
  const rows = await prisma.cabinetAccrual.findMany({
    where: {
      createdAt: { gt: since },
      reversedAt: null,
      project:
        account.role === "investor"
          ? { investorId: account.id }
          : { buyerId: account.id },
    },
    select: { investorPeaches: true, buyerPeaches: true },
  });
  const frozen = rows.reduce((sum, row) => sum + mineOf(account.role, row), 0);
  const hold = Math.min(Math.max(0, account.balancePeaches), Math.max(0, frozen));
  return { hold, available: Math.max(0, account.balancePeaches - hold) };
}

export async function requestCabinetWithdrawal(opts: {
  accountId: string;
  amountPeaches: number;
  payoutDetails: string;
}) {
  const account = await prisma.cabinetAccount.findUnique({ where: { id: opts.accountId } });
  if (!account || account.status !== "active") throw new Error("Нет доступа");
  const amount = Math.floor(opts.amountPeaches);
  if (!Number.isFinite(amount) || amount < CABINET_WITHDRAW_MIN) {
    throw new Error(`Минимум для вывода: ${CABINET_WITHDRAW_MIN}₽`);
  }
  const details = opts.payoutDetails.trim().slice(0, 500);
  if (!details) throw new Error("Укажи реквизиты (USDT TRC20 / карта)");
  const { available } = await cabinetAvailability(account);
  if (amount > account.balancePeaches) throw new Error("Недостаточно на балансе");
  if (amount > available) {
    throw new Error(
      `Сейчас можно создать заявку не больше ${available}₽. Платёжка замораживает оплаты на 3 суток — потом сумма доступна к выводу.`,
    );
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.cabinetAccount.updateMany({
      where: { id: account.id, balancePeaches: { gte: amount } },
      data: { balancePeaches: { decrement: amount } },
    });
    if (updated.count !== 1) throw new Error("Недостаточно на балансе");
    return tx.cabinetWithdrawal.create({
      data: {
        accountId: account.id,
        amountPeaches: amount,
        payoutDetails: details,
        status: "pending",
      },
    });
  });
}

export async function reviewCabinetWithdrawal(opts: {
  id: string;
  action: "approve" | "reject";
  note?: string;
}) {
  const row = await prisma.cabinetWithdrawal.findUnique({ where: { id: opts.id } });
  if (!row) throw new Error("Заявка не найдена");
  if (row.status !== "pending") throw new Error("Заявка уже закрыта");
  const status = opts.action === "approve" ? "paid" : "rejected";
  await prisma.$transaction(async (tx) => {
    await tx.cabinetWithdrawal.update({
      where: { id: row.id },
      data: { status, adminNote: (opts.note || "").slice(0, 500) },
    });
    if (status === "rejected") {
      await tx.cabinetAccount.update({
        where: { id: row.accountId },
        data: { balancePeaches: { increment: row.amountPeaches } },
      });
    }
  });
}

async function linkUrls(code: string, slug: string) {
  let bot = "peachbibot";
  try {
    bot = (await getPrimaryBotUsername()).replace(/^@/, "") || bot;
  } catch {
    /* bot table may be empty locally */
  }
  const bridge = `${bridgeOrigin()}/d/${encodeURIComponent(code)}/${encodeURIComponent(slug)}`;
  const telegram = `https://t.me/${bot}?start=dref_${code}__${slug}`;
  return { bridge, telegram };
}

export type CabinetDealSplit = {
  investorName: string;
  buyerName: string;
  investorPeaches: number;
  buyerPeaches: number;
  investorPct: number;
  buyerPct: number;
  linkLabel: string;
  grossPeaches: number;
};

function splitOf(gross: number, investorPct: number, buyerPct: number) {
  return {
    investorPeaches: Math.floor((gross * investorPct) / 100),
    buyerPeaches: Math.floor((gross * buyerPct) / 100),
  };
}

async function findDealLink(code: string, slug?: string) {
  const cleanCode = code.trim().toLowerCase();
  const cleanSlug = (slug || "").trim().toLowerCase();
  if (!cleanCode || !cleanSlug) return null;
  const project = await prisma.cabinetProject.findUnique({
    where: { code: cleanCode },
    select: { id: true },
  });
  if (!project) return null;
  return prisma.cabinetLink.findUnique({
    where: { projectId_slug: { projectId: project.id, slug: cleanSlug } },
  });
}

/** Count a visit. First open of an unattributed user also binds them to this deal for life. */
export async function touchCabinetStart(opts: {
  userId: string;
  code: string;
  slug?: string;
}): Promise<void> {
  const link = await findDealLink(opts.code, opts.slug);
  if (!link) return;
  const [partner, cabinet] = await Promise.all([
    prisma.partnerAttribution.findUnique({
      where: { userId: opts.userId },
      select: { id: true },
    }),
    prisma.cabinetAttribution.findUnique({
      where: { userId: opts.userId },
      select: { id: true, linkId: true },
    }),
  ]);
  if (partner) return;
  if (cabinet) {
    if (cabinet.linkId === link.id) {
      await prisma.cabinetLink.update({
        where: { id: link.id },
        data: { clicks: { increment: 1 } },
      });
    }
    return;
  }
  try {
    await prisma.$transaction([
      prisma.cabinetLink.update({
        where: { id: link.id },
        data: { clicks: { increment: 1 }, signups: { increment: 1 } },
      }),
      prisma.cabinetAttribution.create({
        data: { userId: opts.userId, projectId: link.projectId, linkId: link.id },
      }),
    ]);
  } catch {
    /* unique userId: another start won the first touch */
  }
}

/** Live top-up of a user who came through a deal link. Does nothing for partner-program users. */
export async function creditCabinetCommission(opts: {
  referredUserId: string;
  grossPeaches: number;
}): Promise<void> {
  const gross = Math.floor(opts.grossPeaches);
  if (!opts.referredUserId || !Number.isFinite(gross) || gross < 1) return;
  const partner = await prisma.partnerAttribution.findUnique({
    where: { userId: opts.referredUserId },
    select: { id: true },
  });
  if (partner) return;
  const attr = await prisma.cabinetAttribution.findUnique({
    where: { userId: opts.referredUserId },
    include: { project: true },
  });
  if (!attr) return;
  const { investorPeaches, buyerPeaches } = splitOf(
    gross,
    attr.project.investorPct,
    attr.project.buyerPct,
  );
  await prisma.$transaction(async (tx) => {
    await tx.cabinetAccrual.create({
      data: {
        projectId: attr.projectId,
        linkId: attr.linkId,
        grossPeaches: gross,
        investorPeaches,
        buyerPeaches,
        investorPct: attr.project.investorPct,
        buyerPct: attr.project.buyerPct,
        referredUserId: opts.referredUserId,
      },
    });
    await tx.cabinetLink.update({
      where: { id: attr.linkId },
      data: {
        purchases: { increment: 1 },
        purchaseGrossPeaches: { increment: gross },
      },
    });
    if (investorPeaches > 0) {
      await tx.cabinetAccount.update({
        where: { id: attr.project.investorId },
        data: {
          balancePeaches: { increment: investorPeaches },
          totalEarnedPeaches: { increment: investorPeaches },
        },
      });
    }
    if (buyerPeaches > 0) {
      await tx.cabinetAccount.update({
        where: { id: attr.project.buyerId },
        data: {
          balancePeaches: { increment: buyerPeaches },
          totalEarnedPeaches: { increment: buyerPeaches },
        },
      });
    }
  });
}

/** Latest live split for this payment, so the payments chat can print the distribution. */
export async function cabinetSplitForPayment(
  userId: string,
  grossPeaches: number,
): Promise<CabinetDealSplit | null> {
  const gross = Math.floor(grossPeaches);
  if (!userId || gross < 1) return null;
  const row = await prisma.cabinetAccrual.findFirst({
    where: { referredUserId: userId, grossPeaches: gross, reversedAt: null },
    orderBy: { createdAt: "desc" },
    include: {
      link: { select: { label: true, slug: true } },
      project: {
        include: {
          investor: { select: { name: true, login: true } },
          buyer: { select: { name: true, login: true } },
        },
      },
    },
  });
  if (!row) return null;
  return {
    investorName: personName(row.project.investor),
    buyerName: personName(row.project.buyer),
    investorPeaches: row.investorPeaches,
    buyerPeaches: row.buyerPeaches,
    investorPct: row.investorPct,
    buyerPct: row.buyerPct,
    linkLabel: row.link?.label || row.link?.slug || "Ссылка",
    grossPeaches: row.grossPeaches,
  };
}

/** Take a deal split back after a payment refund. Balance may go negative if already withdrawn. */
export async function clawbackCabinetCommission(opts: {
  referredUserId: string;
  grossPeaches: number;
}): Promise<CabinetDealSplit | null> {
  const gross = Math.floor(opts.grossPeaches);
  if (!opts.referredUserId || gross < 1) return null;
  const row = await prisma.cabinetAccrual.findFirst({
    where: { referredUserId: opts.referredUserId, grossPeaches: gross, reversedAt: null },
    orderBy: { createdAt: "desc" },
    include: {
      link: { select: { label: true, slug: true } },
      project: {
        include: {
          investor: { select: { name: true, login: true } },
          buyer: { select: { name: true, login: true } },
        },
      },
    },
  });
  if (!row) return null;
  let applied = false;
  await prisma.$transaction(async (tx) => {
    const locked = await tx.cabinetAccrual.updateMany({
      where: { id: row.id, reversedAt: null },
      data: { reversedAt: new Date() },
    });
    if (locked.count !== 1) return;
    applied = true;
    if (row.investorPeaches > 0) {
      await tx.cabinetAccount.update({
        where: { id: row.project.investorId },
        data: {
          balancePeaches: { decrement: row.investorPeaches },
          totalEarnedPeaches: { decrement: row.investorPeaches },
        },
      });
    }
    if (row.buyerPeaches > 0) {
      await tx.cabinetAccount.update({
        where: { id: row.project.buyerId },
        data: {
          balancePeaches: { decrement: row.buyerPeaches },
          totalEarnedPeaches: { decrement: row.buyerPeaches },
        },
      });
    }
    const link = await tx.cabinetLink.findUnique({ where: { id: row.linkId || "" } });
    if (link) {
      await tx.cabinetLink.update({
        where: { id: link.id },
        data: {
          purchases: Math.max(0, link.purchases - 1),
          purchaseGrossPeaches: Math.max(0, link.purchaseGrossPeaches - gross),
        },
      });
    }
  });
  if (!applied) return null;
  return {
    investorName: personName(row.project.investor),
    buyerName: personName(row.project.buyer),
    investorPeaches: row.investorPeaches,
    buyerPeaches: row.buyerPeaches,
    investorPct: row.investorPct,
    buyerPct: row.buyerPct,
    linkLabel: row.link?.label || row.link?.slug || "Ссылка",
    grossPeaches: row.grossPeaches,
  };
}

function notifyCabinetPayments(opts: {
  title: string;
  note?: string;
  investorName: string;
  buyerName: string;
  investorPeaches: number;
  buyerPeaches: number;
  investorPct: number;
  buyerPct: number;
  gross: number;
  linkLabel: string;
}) {
  void import("@/lib/ops/ops-telegram")
    .then(({ sendOpsTelegram, escHtml }) => {
      const lines = [
        opts.title,
        opts.note || "",
        `Оборот: <b>${opts.gross}₽</b>`,
        `Инвестор ${escHtml(opts.investorName)}: <b>${opts.investorPeaches}₽</b> (${opts.investorPct}%)`,
        `Байер ${escHtml(opts.buyerName)}: <b>${opts.buyerPeaches}₽</b> (${opts.buyerPct}%)`,
        `Ссылка: ${escHtml(opts.linkLabel)}`,
      ].filter(Boolean);
      return sendOpsTelegram("payments", lines.join("\n"));
    })
    .catch((e) => console.error("[cabinet] payments notify:", e));
}

type SumRow = {
  grossPeaches: number | null;
  investorPeaches: number | null;
  buyerPeaches: number | null;
};

function sumMine(role: string, row: SumRow | undefined): number {
  if (!row) return 0;
  return role === "investor" ? row.investorPeaches || 0 : row.buyerPeaches || 0;
}

export async function cabinetHome(accountId: string) {
  const account = await prisma.cabinetAccount.findUnique({ where: { id: accountId } });
  if (!account || account.status !== "active") return null;
  const projects = await prisma.cabinetProject.findMany({
    where:
      account.role === "investor"
        ? { investorId: account.id }
        : { buyerId: account.id },
    orderBy: { createdAt: "asc" },
    include: {
      investor: { select: { name: true, login: true } },
      buyer: { select: { name: true, login: true } },
      spends: true,
    },
  });
  const ids = projects.map((p) => p.id);
  const [sums, withdrawals, recent, avail] = await Promise.all([
    ids.length
      ? prisma.cabinetAccrual.groupBy({
          by: ["projectId"],
          where: { projectId: { in: ids }, reversedAt: null },
          _sum: { grossPeaches: true, investorPeaches: true, buyerPeaches: true },
        })
      : Promise.resolve([]),
    prisma.cabinetWithdrawal.findMany({
      where: { accountId: account.id },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    ids.length
      ? prisma.cabinetAccrual.findMany({
          where: { projectId: { in: ids } },
          orderBy: { createdAt: "desc" },
          take: 20,
          include: {
            link: { select: { label: true } },
            project: {
              select: {
                investor: { select: { name: true, login: true } },
                buyer: { select: { name: true, login: true } },
              },
            },
          },
        })
      : Promise.resolve([]),
    cabinetAvailability(account),
  ]);
  const byProject = new Map(sums.map((s) => [s.projectId, s._sum]));

  return {
    account: {
      id: account.id,
      login: account.login,
      name: personName(account),
      role: account.role,
      balancePeaches: account.balancePeaches,
      totalEarnedPeaches: account.totalEarnedPeaches,
      holdPeaches: avail.hold,
      availablePeaches: avail.available,
    },
    projects: projects.map((p) => {
      const other = account.role === "investor" ? p.buyer : p.investor;
      const sum = byProject.get(p.id);
      const investedRub = p.spends.reduce((s, x) => s + x.amountRub, 0);
      const reportedRub = p.spends
        .filter((x) => x.reportedAt)
        .reduce((s, x) => s + x.amountRub, 0);
      return {
        id: p.id,
        chatUrl: p.chatUrl,
        investorPct: p.investorPct,
        buyerPct: p.buyerPct,
        myPct: account.role === "investor" ? p.investorPct : p.buyerPct,
        counterpartName: personName(other),
        gross: sum?.grossPeaches || 0,
        myCommission: sumMine(account.role, sum),
        investedRub,
        reportedRub,
        openSpends: p.spends.filter((x) => !x.reportedAt).length,
      };
    }),
    accruals: recent.map((a) => ({
      id: a.id,
      projectId: a.projectId,
      counterpartName: personName(
        account.role === "investor" ? a.project.buyer : a.project.investor,
      ),
      linkLabel: a.link?.label || "Ссылка",
      gross: a.grossPeaches,
      mine: mineOf(account.role, a),
      other: account.role === "investor" ? a.buyerPeaches : a.investorPeaches,
      reversed: a.reversedAt != null,
      createdAt: a.createdAt.toISOString(),
    })),
    withdrawals: withdrawals.map((w) => ({
      id: w.id,
      amountPeaches: w.amountPeaches,
      status: w.status,
      payoutDetails: w.payoutDetails,
      createdAt: w.createdAt.toISOString(),
    })),
  };
}

export async function cabinetProjectView(accountId: string, projectId: string) {
  const account = await prisma.cabinetAccount.findUnique({ where: { id: accountId } });
  if (!account || account.status !== "active") return null;
  let project: Awaited<ReturnType<typeof projectFor>>;
  try {
    project = await projectFor(accountId, projectId);
  } catch {
    return null;
  }
  const [links, spends, accruals, linkSums, avail] = await Promise.all([
    prisma.cabinetLink.findMany({
      where: { projectId: project.id },
      orderBy: { createdAt: "asc" },
    }),
    prisma.cabinetSpend.findMany({
      where: { projectId: project.id },
      orderBy: { createdAt: "desc" },
    }),
    prisma.cabinetAccrual.findMany({
      where: { projectId: project.id },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { link: { select: { label: true } } },
    }),
    prisma.cabinetAccrual.groupBy({
      by: ["linkId"],
      where: { projectId: project.id, reversedAt: null },
      _sum: { investorPeaches: true, buyerPeaches: true, grossPeaches: true },
    }),
    cabinetAvailability(account),
  ]);
  const byLink = new Map(linkSums.map((s) => [s.linkId, s._sum]));
  const other = account.role === "investor" ? project.buyer : project.investor;
  const urls = await Promise.all(links.map((l) => linkUrls(project.code, l.slug)));

  return {
    account: {
      id: account.id,
      name: personName(account),
      role: account.role,
      balancePeaches: account.balancePeaches,
      availablePeaches: avail.available,
      holdPeaches: avail.hold,
    },
    project: {
      id: project.id,
      chatUrl: project.chatUrl,
      investorPct: project.investorPct,
      buyerPct: project.buyerPct,
      myPct: account.role === "investor" ? project.investorPct : project.buyerPct,
      counterpartName: personName(other),
      investedRub: spends.reduce((s, x) => s + x.amountRub, 0),
      reportedRub: spends.filter((x) => x.reportedAt).reduce((s, x) => s + x.amountRub, 0),
      gross: linkSums.reduce((s, x) => s + (x._sum.grossPeaches || 0), 0),
      myCommission: linkSums.reduce((s, x) => s + sumMine(account.role, x._sum), 0),
      referrals: links.reduce((s, l) => s + l.signups, 0),
      purchases: links.reduce((s, l) => s + l.purchases, 0),
    },
    links: links.map((l, i) => ({
      id: l.id,
      label: l.label,
      slug: l.slug,
      clicks: l.clicks,
      signups: l.signups,
      purchases: l.purchases,
      purchaseGrossPeaches: l.purchaseGrossPeaches,
      myCommission: sumMine(account.role, byLink.get(l.id)),
      bridgeUrl: urls[i]!.bridge,
      telegramUrl: urls[i]!.telegram,
    })),
    spends: spends.map((s) => ({
      id: s.id,
      amountRub: s.amountRub,
      reportTitle: s.reportTitle,
      reportBody: s.reportBody,
      hasFile: Boolean(s.reportFile),
      reportedAt: s.reportedAt?.toISOString() || null,
      createdAt: s.createdAt.toISOString(),
    })),
    accruals: accruals.map((a) => ({
      id: a.id,
      linkLabel: a.link?.label || "Ссылка",
      gross: a.grossPeaches,
      mine: mineOf(account.role, a),
      other: account.role === "investor" ? a.buyerPeaches : a.investorPeaches,
      reversed: a.reversedAt != null,
      createdAt: a.createdAt.toISOString(),
    })),
  };
}

export async function cabinetSpendFile(opts: {
  accountId?: string | null;
  ops?: boolean;
  spendId: string;
}) {
  const spend = await prisma.cabinetSpend.findUnique({
    where: { id: opts.spendId },
    include: { project: { select: { investorId: true, buyerId: true } } },
  });
  if (!spend || !spend.reportFile) return null;
  if (!opts.ops) {
    if (
      !opts.accountId ||
      (spend.project.investorId !== opts.accountId && spend.project.buyerId !== opts.accountId)
    ) {
      return null;
    }
  }
  const abs = cabinetReportPath(spend.reportFile);
  if (!abs || !fs.existsSync(abs)) return null;
  const ext = path.extname(abs).slice(1).toLowerCase();
  const type =
    ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
  return { abs, type };
}
