import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import { createCabinetAccount, createCabinetProject } from "@/lib/cabinet/service";

/**
 * Local-only demo logins. Created once, only against localhost Postgres,
 * never in production and never against a remote database.
 */
export const CABINET_DEMO = {
  investor: { login: "investor", password: "test-investor-30", name: "Тестовый инвестор" },
  buyer: { login: "buyer", password: "test-buyer-30", name: "Тестовый байер" },
  ops: { login: "owner", password: "test-owner-30", email: "owner@ops.local", name: "Локальный админ" },
} as const;

function localDatabase(): boolean {
  if (process.env.NODE_ENV === "production") return false;
  if (process.env.CABINET_SEED === "0") return false;
  const raw = process.env.DATABASE_URL || "";
  if (!raw.startsWith("postgres")) return false;
  try {
    const host = new URL(raw).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch {
    return false;
  }
}

let pending: Promise<void> | null = null;

export function ensureCabinetDemo(): Promise<void> {
  if (!localDatabase()) return Promise.resolve();
  if (!pending) {
    pending = seed().catch((err) => {
      pending = null;
      throw err;
    });
  }
  return pending;
}

async function seed() {
  const investor = await prisma.cabinetAccount.findUnique({
    where: { login: CABINET_DEMO.investor.login },
  });
  const buyer = await prisma.cabinetAccount.findUnique({
    where: { login: CABINET_DEMO.buyer.login },
  });

  const investorRow =
    investor ||
    (
      await createCabinetAccount({
        role: "investor",
        name: CABINET_DEMO.investor.name,
        login: CABINET_DEMO.investor.login,
        password: CABINET_DEMO.investor.password,
      })
    ).account;

  const buyerRow =
    buyer ||
    (
      await createCabinetAccount({
        role: "buyer",
        name: CABINET_DEMO.buyer.name,
        login: CABINET_DEMO.buyer.login,
        password: CABINET_DEMO.buyer.password,
      })
    ).account;

  const existing = await prisma.cabinetProject.findUnique({
    where: {
      investorId_buyerId: { investorId: investorRow.id, buyerId: buyerRow.id },
    },
    select: { id: true },
  });
  if (!existing) {
    await createCabinetProject({
      investorId: investorRow.id,
      buyerId: buyerRow.id,
      chatUrl: "",
    });
  }

  const ops = await prisma.user.findUnique({
    where: { email: CABINET_DEMO.ops.email },
    select: { id: true },
  });
  if (!ops) {
    await prisma.user.create({
      data: {
        email: CABINET_DEMO.ops.email,
        name: CABINET_DEMO.ops.name,
        passwordHash: await hashPassword(CABINET_DEMO.ops.password),
        adminRole: "owner",
        ageConfirmed: true,
      },
    });
  }
}
