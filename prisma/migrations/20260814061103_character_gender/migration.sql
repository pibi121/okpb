-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Character" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "gender" TEXT NOT NULL DEFAULT 'female',
    "consentGiven" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'ready',
    "photoCount" INTEGER NOT NULL DEFAULT 0,
    "loraPath" TEXT,
    "loraStatus" TEXT NOT NULL DEFAULT 'lookbook',
    "triggerWord" TEXT,
    "lookbookJson" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Character_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Character" ("consentGiven", "createdAt", "description", "id", "lookbookJson", "loraPath", "loraStatus", "name", "photoCount", "status", "triggerWord", "updatedAt", "userId") SELECT "consentGiven", "createdAt", "description", "id", "lookbookJson", "loraPath", "loraStatus", "name", "photoCount", "status", "triggerWord", "updatedAt", "userId" FROM "Character";
DROP TABLE "Character";
ALTER TABLE "new_Character" RENAME TO "Character";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
