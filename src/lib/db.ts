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
  "growthPlan",
] as const;

function hasDelegates(client: PrismaClient | undefined): boolean {
  if (!client) return false;
  const c = client as unknown as Record<string, unknown>;
  return REQUIRED_DELEGATES.every((k) => typeof c[k] !== "undefined");
}

/** Railway reports the host CPU count, so Prisma's default pool was 97 per process. */
const PG_POOL_LIMIT = 8;

function cappedDatabaseUrl(): string | undefined {
  const raw = process.env.DATABASE_URL || "";
  if (!raw.startsWith("postgres")) return undefined;
  const qIndex = raw.indexOf("?");
  const base = qIndex >= 0 ? raw.slice(0, qIndex) : raw;
  const params = new URLSearchParams(qIndex >= 0 ? raw.slice(qIndex + 1) : "");
  const current = Number(params.get("connection_limit") || "");
  if (!Number.isFinite(current) || current <= 0 || current > PG_POOL_LIMIT) {
    params.set("connection_limit", String(PG_POOL_LIMIT));
  }
  if (!params.get("pool_timeout")) params.set("pool_timeout", "10");
  return `${base}?${params.toString()}`;
}

function createPrisma() {
  const datasourceUrl = cappedDatabaseUrl();
  if (datasourceUrl) {
    console.log("[db] postgres pool limit", PG_POOL_LIMIT);
  }
  return new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
    ...(datasourceUrl ? { datasourceUrl } : {}),
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
  globalForPrisma.prisma = next;
  return next;
}

export const prisma = getPrisma();

/** Prod cutover: Postgres URL. File URL stays the SQLite path. */
export function isFileDatabase(): boolean {
  return (process.env.DATABASE_URL || "").startsWith("file:");
}

/** SQLite / Prisma engine wedged for a moment. Safe to retry the same read. */
export function isTransientDbError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err || "");
  const code =
    err && typeof err === "object" && "code" in err
      ? String((err as { code?: string }).code || "")
      : "";
  return (
    code === "P1008" ||
    code === "P1001" ||
    code === "P1017" ||
    code === "P2024" ||
    /Socket timeout|database is locked|SQLITE_BUSY|Timeout exceeded|Connection terminated|ECONNRESET|ECONNREFUSED|Timed out fetching a new connection|connection pool|too many connections|remaining connection slots/i.test(
      msg,
    )
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
