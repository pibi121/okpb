/**
 * Additive only: create FunnelLookPack if it is missing.
 * Refuses anything except Postgres. Does not print the connection string.
 */
import { PrismaClient } from "@prisma/client";

const url = process.env.DATABASE_URL || "";
if (!url.startsWith("postgres")) {
  console.error("refused: database is not postgres");
  process.exit(1);
}

const prisma = new PrismaClient();

const CREATE_TABLE = `
CREATE TABLE IF NOT EXISTS "FunnelLookPack" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "tgDisplayTitle" TEXT NOT NULL DEFAULT '',
    "pricePeaches" INTEGER NOT NULL DEFAULT 270,
    "previewVideoUrl" TEXT NOT NULL DEFAULT '',
    "scenesJson" TEXT NOT NULL DEFAULT '[]',
    "funnelV2Published" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FunnelLookPack_pkey" PRIMARY KEY ("id")
)`;

const CREATE_INDEX = `
CREATE INDEX IF NOT EXISTS "FunnelLookPack_funnelV2Published_sortOrder_idx"
ON "FunnelLookPack"("funnelV2Published", "sortOrder")`;

function safe(err) {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.replace(/postgres(?:ql)?:\/\/\S+/gi, "[redacted]").slice(0, 240);
}

try {
  const before = await prisma.$queryRawUnsafe(
    `SELECT to_regclass('public."FunnelLookPack"')::text AS rel`,
  );
  const existed = Boolean(before?.[0]?.rel);
  await prisma.$executeRawUnsafe(CREATE_TABLE);
  await prisma.$executeRawUnsafe(CREATE_INDEX);
  const after = await prisma.$queryRawUnsafe(
    `SELECT to_regclass('public."FunnelLookPack"')::text AS rel`,
  );
  console.log(existed ? "table already present" : "table created");
  console.log(after?.[0]?.rel ? "check ok" : "check failed");
  if (!after?.[0]?.rel) process.exit(1);
} catch (err) {
  console.error("ensure failed:", safe(err));
  process.exit(1);
} finally {
  await prisma.$disconnect();
}
