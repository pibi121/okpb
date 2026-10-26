-- Bind a Telegram user to one deal link, and remember which payment was split.

ALTER TABLE "CabinetAccrual" ADD COLUMN "referredUserId" TEXT;
ALTER TABLE "CabinetAccrual" ADD COLUMN "reversedAt" TIMESTAMP(3);

CREATE INDEX "CabinetAccrual_referredUserId_createdAt_idx" ON "CabinetAccrual"("referredUserId", "createdAt");

CREATE TABLE "CabinetAttribution" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "linkId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CabinetAttribution_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CabinetAttribution_userId_key" ON "CabinetAttribution"("userId");
CREATE INDEX "CabinetAttribution_projectId_idx" ON "CabinetAttribution"("projectId");
CREATE INDEX "CabinetAttribution_linkId_idx" ON "CabinetAttribution"("linkId");

ALTER TABLE "CabinetAttribution" ADD CONSTRAINT "CabinetAttribution_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CabinetAttribution" ADD CONSTRAINT "CabinetAttribution_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "CabinetProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CabinetAttribution" ADD CONSTRAINT "CabinetAttribution_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "CabinetLink"("id") ON DELETE CASCADE ON UPDATE CASCADE;
