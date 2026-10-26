-- Investor / buyer web cabinets. Separate from the Telegram partner program.

CREATE TABLE "CabinetAccount" (
    "id" TEXT NOT NULL,
    "login" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "balancePeaches" INTEGER NOT NULL DEFAULT 0,
    "totalEarnedPeaches" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CabinetAccount_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CabinetAccount_login_key" ON "CabinetAccount"("login");

CREATE TABLE "CabinetProject" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "investorId" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "investorPct" INTEGER NOT NULL DEFAULT 30,
    "buyerPct" INTEGER NOT NULL DEFAULT 30,
    "chatUrl" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CabinetProject_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CabinetProject_code_key" ON "CabinetProject"("code");
CREATE UNIQUE INDEX "CabinetProject_investorId_buyerId_key" ON "CabinetProject"("investorId", "buyerId");
CREATE INDEX "CabinetProject_buyerId_idx" ON "CabinetProject"("buyerId");

CREATE TABLE "CabinetLink" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "signups" INTEGER NOT NULL DEFAULT 0,
    "purchases" INTEGER NOT NULL DEFAULT 0,
    "purchaseGrossPeaches" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CabinetLink_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CabinetLink_projectId_slug_key" ON "CabinetLink"("projectId", "slug");
CREATE INDEX "CabinetLink_projectId_idx" ON "CabinetLink"("projectId");

CREATE TABLE "CabinetAccrual" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "linkId" TEXT,
    "grossPeaches" INTEGER NOT NULL,
    "investorPeaches" INTEGER NOT NULL,
    "buyerPeaches" INTEGER NOT NULL,
    "investorPct" INTEGER NOT NULL,
    "buyerPct" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CabinetAccrual_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CabinetAccrual_projectId_createdAt_idx" ON "CabinetAccrual"("projectId", "createdAt");
CREATE INDEX "CabinetAccrual_linkId_idx" ON "CabinetAccrual"("linkId");

CREATE TABLE "CabinetSpend" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "amountRub" INTEGER NOT NULL,
    "reportTitle" TEXT NOT NULL DEFAULT '',
    "reportBody" TEXT NOT NULL DEFAULT '',
    "reportFile" TEXT NOT NULL DEFAULT '',
    "reportedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CabinetSpend_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CabinetSpend_projectId_createdAt_idx" ON "CabinetSpend"("projectId", "createdAt");

CREATE TABLE "CabinetWithdrawal" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "amountPeaches" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "payoutDetails" TEXT NOT NULL DEFAULT '',
    "adminNote" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CabinetWithdrawal_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CabinetWithdrawal_accountId_status_idx" ON "CabinetWithdrawal"("accountId", "status");
CREATE INDEX "CabinetWithdrawal_status_createdAt_idx" ON "CabinetWithdrawal"("status", "createdAt");

ALTER TABLE "CabinetProject" ADD CONSTRAINT "CabinetProject_investorId_fkey" FOREIGN KEY ("investorId") REFERENCES "CabinetAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CabinetProject" ADD CONSTRAINT "CabinetProject_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "CabinetAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CabinetLink" ADD CONSTRAINT "CabinetLink_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "CabinetProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CabinetAccrual" ADD CONSTRAINT "CabinetAccrual_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "CabinetProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CabinetAccrual" ADD CONSTRAINT "CabinetAccrual_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "CabinetLink"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CabinetSpend" ADD CONSTRAINT "CabinetSpend_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "CabinetProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CabinetWithdrawal" ADD CONSTRAINT "CabinetWithdrawal_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "CabinetAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
