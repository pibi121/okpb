-- PartnerWithdrawal: nullable partnerId, volume bonus, fake announces for partners chat.
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_PartnerWithdrawal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "partnerId" TEXT,
    "amountPeaches" INTEGER NOT NULL,
    "volumeBonusPeaches" INTEGER NOT NULL DEFAULT 0,
    "isFake" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "payoutDetails" TEXT NOT NULL DEFAULT '',
    "adminNote" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PartnerWithdrawal_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "PartnerProfile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_PartnerWithdrawal" ("id", "partnerId", "amountPeaches", "volumeBonusPeaches", "isFake", "status", "payoutDetails", "adminNote", "createdAt", "updatedAt")
SELECT "id", "partnerId", "amountPeaches", 0, false, "status", "payoutDetails", "adminNote", "createdAt", "updatedAt" FROM "PartnerWithdrawal";
DROP TABLE "PartnerWithdrawal";
ALTER TABLE "new_PartnerWithdrawal" RENAME TO "PartnerWithdrawal";
CREATE INDEX "PartnerWithdrawal_partnerId_status_idx" ON "PartnerWithdrawal"("partnerId", "status");
CREATE INDEX "PartnerWithdrawal_isFake_createdAt_idx" ON "PartnerWithdrawal"("isFake", "createdAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
