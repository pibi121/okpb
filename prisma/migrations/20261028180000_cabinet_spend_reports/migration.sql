-- Buyer purchases against part of an investor transfer.
CREATE TABLE "CabinetSpendReport" (
    "id" TEXT NOT NULL,
    "spendId" TEXT NOT NULL,
    "amountRub" INTEGER NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "body" TEXT NOT NULL DEFAULT '',
    "file" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CabinetSpendReport_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CabinetSpendReport_spendId_createdAt_idx" ON "CabinetSpendReport"("spendId", "createdAt");

ALTER TABLE "CabinetSpendReport" ADD CONSTRAINT "CabinetSpendReport_spendId_fkey" FOREIGN KEY ("spendId") REFERENCES "CabinetSpend"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Keep an already attached single report as one purchase for the whole sum.
INSERT INTO "CabinetSpendReport" ("id", "spendId", "amountRub", "title", "body", "file", "createdAt")
SELECT "id", "id", "amountRub", "reportTitle", "reportBody", "reportFile", "reportedAt"
FROM "CabinetSpend"
WHERE "reportedAt" IS NOT NULL;
