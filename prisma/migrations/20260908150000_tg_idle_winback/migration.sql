-- AlterTable
ALTER TABLE "User" ADD COLUMN "tgLastActiveAt" DATETIME;
ALTER TABLE "User" ADD COLUMN "tgIdle3dSent" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "tgIdle7dSent" BOOLEAN NOT NULL DEFAULT false;

-- Start idle clock now so we don't blast all old users on deploy.
UPDATE "User" SET "tgLastActiveAt" = CURRENT_TIMESTAMP WHERE "tgLastActiveAt" IS NULL;
