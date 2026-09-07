-- Partner program + studio cast fixes already in prior migration

CREATE TABLE "PartnerProfile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "commissionPct" INTEGER NOT NULL DEFAULT 50,
    "balancePeaches" INTEGER NOT NULL DEFAULT 0,
    "totalEarnedPeaches" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PartnerProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "PartnerLink" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "partnerId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "signups" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PartnerLink_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "PartnerProfile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "PartnerAttribution" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "linkId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PartnerAttribution_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PartnerAttribution_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "PartnerProfile" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PartnerAttribution_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "PartnerLink" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "PartnerCommission" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "partnerId" TEXT NOT NULL,
    "referredUserId" TEXT NOT NULL,
    "grossPeaches" INTEGER NOT NULL,
    "amountPeaches" INTEGER NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'topup',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PartnerCommission_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "PartnerProfile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "PartnerWithdrawal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "partnerId" TEXT NOT NULL,
    "amountPeaches" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "payoutDetails" TEXT NOT NULL DEFAULT '',
    "adminNote" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PartnerWithdrawal_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "PartnerProfile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "PartnerProfile_userId_key" ON "PartnerProfile"("userId");
CREATE UNIQUE INDEX "PartnerProfile_code_key" ON "PartnerProfile"("code");
CREATE UNIQUE INDEX "PartnerLink_partnerId_slug_key" ON "PartnerLink"("partnerId", "slug");
CREATE INDEX "PartnerLink_partnerId_idx" ON "PartnerLink"("partnerId");
CREATE UNIQUE INDEX "PartnerAttribution_userId_key" ON "PartnerAttribution"("userId");
CREATE INDEX "PartnerAttribution_partnerId_idx" ON "PartnerAttribution"("partnerId");
CREATE INDEX "PartnerCommission_partnerId_createdAt_idx" ON "PartnerCommission"("partnerId", "createdAt");
CREATE INDEX "PartnerWithdrawal_partnerId_status_idx" ON "PartnerWithdrawal"("partnerId", "status");
