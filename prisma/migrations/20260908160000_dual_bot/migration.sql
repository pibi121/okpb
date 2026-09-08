-- Dual-bot: tokens + primary flag + last bot on platform account
ALTER TABLE "BotInstance" ADD COLUMN IF NOT EXISTS "telegramBotId" TEXT NOT NULL DEFAULT '';
ALTER TABLE "BotInstance" ADD COLUMN IF NOT EXISTS "tokenEnc" TEXT NOT NULL DEFAULT '';
ALTER TABLE "BotInstance" ADD COLUMN IF NOT EXISTS "isPrimary" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "BotInstance_username_idx" ON "BotInstance"("username");
CREATE INDEX IF NOT EXISTS "BotInstance_isPrimary_status_idx" ON "BotInstance"("isPrimary", "status");

ALTER TABLE "PlatformAccount" ADD COLUMN IF NOT EXISTS "lastBotInstanceId" TEXT;
