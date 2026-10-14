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

/** SQLite / Prisma engine wedged for a moment. Safe to retry the same read. */
export function isTransientDbError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err || "");
  const code =
    err && typeof err === "object" && "code" in err
      ? String((err as { code?: string }).code || "")
      : "";
  return (
    code === "P1008" ||
    /Socket timeout|database is locked|SQLITE_BUSY|Timeout exceeded/i.test(msg)
  );
}

export async function withDbRetry<T>(
  fn: () => Promise<T>,
  attempts = 3,
): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (!isTransientDbError(e) || i === attempts - 1) throw e;
      await new Promise((r) => setTimeout(r, 300 * (i + 1)));
    }
  }
  throw last;
}
