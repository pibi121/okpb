-- AlterTable
ALTER TABLE "TemplateFrame" ADD COLUMN "dialogue" TEXT NOT NULL DEFAULT '';

-- CreateTable
CREATE TABLE "TemplateRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "packId" TEXT NOT NULL,
    "characterIdsJson" TEXT NOT NULL DEFAULT '[]',
    "step" TEXT NOT NULL DEFAULT 'characters',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TemplateRun_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TemplateRun_packId_fkey" FOREIGN KEY ("packId") REFERENCES "TemplatePack" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TemplateRunFrame" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT NOT NULL,
    "templateFrameId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "stillItemId" TEXT,
    "clipItemId" TEXT,
    "videoNote" TEXT NOT NULL DEFAULT '',
    "dialogue" TEXT NOT NULL DEFAULT '',
    "videoPrompt" TEXT NOT NULL DEFAULT '',
    "durationSec" INTEGER NOT NULL DEFAULT 5,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TemplateRunFrame_runId_fkey" FOREIGN KEY ("runId") REFERENCES "TemplateRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "TemplateRun_userId_idx" ON "TemplateRun"("userId");

-- CreateIndex
CREATE INDEX "TemplateRun_packId_idx" ON "TemplateRun"("packId");

-- CreateIndex
CREATE INDEX "TemplateRunFrame_runId_idx" ON "TemplateRunFrame"("runId");
