-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_RenderJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "scenarioId" TEXT,
    "characterId" TEXT,
    "phase" TEXT NOT NULL DEFAULT 'full',
    "status" TEXT NOT NULL DEFAULT 'queued',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "totalCredits" INTEGER NOT NULL DEFAULT 0,
    "resultUrl" TEXT,
    "errorMessage" TEXT,
    "shotsJson" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "RenderJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RenderJob_scenarioId_fkey" FOREIGN KEY ("scenarioId") REFERENCES "Scenario" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "RenderJob_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_RenderJob" ("characterId", "createdAt", "errorMessage", "id", "progress", "resultUrl", "scenarioId", "shotsJson", "status", "totalCredits", "updatedAt", "userId") SELECT "characterId", "createdAt", "errorMessage", "id", "progress", "resultUrl", "scenarioId", "shotsJson", "status", "totalCredits", "updatedAt", "userId" FROM "RenderJob";
DROP TABLE "RenderJob";
ALTER TABLE "new_RenderJob" RENAME TO "RenderJob";
CREATE TABLE "new_ShotJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "renderJobId" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "actionType" TEXT NOT NULL DEFAULT 'idle',
    "actionPrompt" TEXT,
    "dialogueText" TEXT,
    "camera" TEXT NOT NULL DEFAULT 'medium',
    "locationJson" TEXT NOT NULL DEFAULT '{}',
    "audioJson" TEXT,
    "durationSec" INTEGER NOT NULL DEFAULT 5,
    "billingCredits" INTEGER NOT NULL DEFAULT 0,
    "workflow" TEXT NOT NULL DEFAULT 'still_i2v',
    "continuity" TEXT NOT NULL DEFAULT 'continue',
    "stillUrl" TEXT,
    "resultUrl" TEXT,
    "lastFrameUrl" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ShotJob_renderJobId_fkey" FOREIGN KEY ("renderJobId") REFERENCES "RenderJob" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ShotJob" ("actionPrompt", "actionType", "audioJson", "billingCredits", "camera", "createdAt", "dialogueText", "durationSec", "id", "lastFrameUrl", "locationJson", "orderIndex", "renderJobId", "resultUrl", "status", "updatedAt", "workflow") SELECT "actionPrompt", "actionType", "audioJson", "billingCredits", "camera", "createdAt", "dialogueText", "durationSec", "id", "lastFrameUrl", "locationJson", "orderIndex", "renderJobId", "resultUrl", "status", "updatedAt", "workflow" FROM "ShotJob";
DROP TABLE "ShotJob";
ALTER TABLE "new_ShotJob" RENAME TO "ShotJob";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
