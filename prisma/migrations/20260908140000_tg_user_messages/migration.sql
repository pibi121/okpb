-- CreateTable
CREATE TABLE "TgUserMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "platformUserId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "readAt" DATETIME,
    "replyToId" TEXT,
    "metaJson" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TgUserMessage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "TgUserMessage_userId_createdAt_idx" ON "TgUserMessage"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "TgUserMessage_createdAt_idx" ON "TgUserMessage"("createdAt");

-- CreateIndex
CREATE INDEX "TgUserMessage_direction_readAt_idx" ON "TgUserMessage"("direction", "readAt");

-- CreateIndex
CREATE INDEX "TgUserMessage_platformUserId_createdAt_idx" ON "TgUserMessage"("platformUserId", "createdAt");
