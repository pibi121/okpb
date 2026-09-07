import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

const REQUIRED_DELEGATES = [
  "templatePack",
  "templateRun",
  "motionTemplate",
  "motionRun",
  "socialTemplate",
  "socialRef2VRun",
  "quickVideoRun",
  "quickVideoTemplate",
  "quickVideoTemplatePurchase",
  "peachPhotoTemplate",
  "peachPhotoTemplatePurchase",
  "loraI2vTemplate",
  "trafficLink",
  "opsError",
  "opsSetting",
  "botCopy",
  "systemNotice",
  "broadcast",
  "adminAudit",
  "opsExpense",
] as const;

function hasDelegates(client: PrismaClient | undefined): boolean {
  if (!client) return false;
  const c = client as unknown as Record<string, unknown>;
  return REQUIRED_DELEGATES.every((k) => typeof c[k] !== "undefined");
}

function createPrisma() {
  return new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });
}

function getPrisma(): PrismaClient {
  const cached = globalForPrisma.prisma;
  if (hasDelegates(cached)) return cached!;

  if (cached) {
    console.warn(
      "[peach] Prisma client stale (missing delegates) — recreating after prisma generate",
    );
    void cached.$disconnect().catch(() => undefined);
  }

  const next = createPrisma();
  if (process.env.NODE_ENV !== "production") {
    globalForPrisma.prisma = next;
  }
  return next;
}

export const prisma = getPrisma();
