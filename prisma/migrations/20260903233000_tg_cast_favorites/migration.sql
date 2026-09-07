-- Studio cast favorites for Mini App
CREATE TABLE "TgCastFavorite" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TgCastFavorite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TgCastFavorite_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "TgCastFavorite_userId_characterId_key" ON "TgCastFavorite"("userId", "characterId");
CREATE INDEX "TgCastFavorite_userId_idx" ON "TgCastFavorite"("userId");
