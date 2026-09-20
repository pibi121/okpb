-- CreateTable
CREATE TABLE "QualityClaim" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "galleryItemId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "chargedPeaches" INTEGER NOT NULL DEFAULT 0,
    "refundedPeaches" INTEGER NOT NULL DEFAULT 0,
    "tgChatId" TEXT NOT NULL DEFAULT '',
    "tgMessageId" INTEGER,
    "opsChatId" TEXT NOT NULL DEFAULT '',
    "opsMessageId" INTEGER,
    "reviewedById" TEXT,
    "reviewedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "QualityClaim_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "QualityClaim_galleryItemId_fkey" FOREIGN KEY ("galleryItemId") REFERENCES "GalleryItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "QualityClaim_galleryItemId_key" ON "QualityClaim"("galleryItemId");

-- CreateIndex
CREATE INDEX "QualityClaim_status_createdAt_idx" ON "QualityClaim"("status", "createdAt");

-- CreateIndex
CREATE INDEX "QualityClaim_userId_createdAt_idx" ON "QualityClaim"("userId", "createdAt");
