-- CreateTable
CREATE TABLE "AgeGateReview" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "platformUserId" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'ru',
    "photoRelKey" TEXT NOT NULL,
    "photoUrl" TEXT NOT NULL,
    "photoHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "gateJson" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" DATETIME,
    "reviewedByOpsUserId" TEXT
);

-- CreateIndex
CREATE INDEX "AgeGateReview_status_createdAt_idx" ON "AgeGateReview"("status", "createdAt");

-- CreateIndex
CREATE INDEX "AgeGateReview_photoHash_status_idx" ON "AgeGateReview"("photoHash", "status");

-- CreateIndex
CREATE INDEX "AgeGateReview_userId_status_idx" ON "AgeGateReview"("userId", "status");
