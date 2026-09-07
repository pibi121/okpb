-- Ops cabinet: staff roles, traffic links, errors, copy, broadcasts, money

ALTER TABLE "User" ADD COLUMN "adminRole" TEXT NOT NULL DEFAULT '';
ALTER TABLE "User" ADD COLUMN "blocked" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "blockedAt" DATETIME;
ALTER TABLE "User" ADD COLUMN "blockReason" TEXT NOT NULL DEFAULT '';
ALTER TABLE "User" ADD COLUMN "adminNotes" TEXT NOT NULL DEFAULT '';
ALTER TABLE "User" ADD COLUMN "trafficLinkId" TEXT;

CREATE TABLE "TrafficLink" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "signups" INTEGER NOT NULL DEFAULT 0,
    "purchases" INTEGER NOT NULL DEFAULT 0,
    "purchasePeaches" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE UNIQUE INDEX "TrafficLink_code_key" ON "TrafficLink"("code");

CREATE TABLE "OpsError" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fingerprint" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "sampleMessage" TEXT NOT NULL DEFAULT '',
    "sampleStack" TEXT NOT NULL DEFAULT '',
    "count" INTEGER NOT NULL DEFAULT 1,
    "lastUserId" TEXT NOT NULL DEFAULT '',
    "lastMetaJson" TEXT NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'open',
    "firstAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "OpsError_fingerprint_key" ON "OpsError"("fingerprint");
CREATE INDEX "OpsError_status_lastAt_idx" ON "OpsError"("status", "lastAt");
CREATE INDEX "OpsError_kind_lastAt_idx" ON "OpsError"("kind", "lastAt");

CREATE TABLE "OpsSetting" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "maintenance" BOOLEAN NOT NULL DEFAULT false,
    "maintenanceMessageRu" TEXT NOT NULL DEFAULT '',
    "maintenanceMessageEn" TEXT NOT NULL DEFAULT '',
    "loadMode" BOOLEAN NOT NULL DEFAULT false,
    "loadMessageRu" TEXT NOT NULL DEFAULT '',
    "loadMessageEn" TEXT NOT NULL DEFAULT '',
    "lastBroadcastAt" DATETIME,
    "pricesJson" TEXT NOT NULL DEFAULT '{}',
    "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "BotCopy" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "slot" TEXT NOT NULL,
    "textRu" TEXT NOT NULL DEFAULT '',
    "textEn" TEXT NOT NULL DEFAULT '',
    "mediaUrl" TEXT NOT NULL DEFAULT '',
    "updatedAt" DATETIME NOT NULL
);

CREATE UNIQUE INDEX "BotCopy_slot_key" ON "BotCopy"("slot");

CREATE TABLE "SystemNotice" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "slot" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "textRu" TEXT NOT NULL DEFAULT '',
    "textEn" TEXT NOT NULL DEFAULT '',
    "mediaUrl" TEXT NOT NULL DEFAULT '',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" DATETIME NOT NULL
);

CREATE UNIQUE INDEX "SystemNotice_slot_key" ON "SystemNotice"("slot");

CREATE TABLE "Broadcast" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "title" TEXT NOT NULL,
    "bodyRu" TEXT NOT NULL DEFAULT '',
    "bodyEn" TEXT NOT NULL DEFAULT '',
    "mediaUrl" TEXT NOT NULL DEFAULT '',
    "filterJson" TEXT NOT NULL DEFAULT '{}',
    "createdById" TEXT NOT NULL DEFAULT '',
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "failCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" DATETIME
);

CREATE TABLE "AdminAudit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL DEFAULT '',
    "targetId" TEXT NOT NULL DEFAULT '',
    "detailJson" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "AdminAudit_createdAt_idx" ON "AdminAudit"("createdAt");
CREATE INDEX "AdminAudit_actorId_createdAt_idx" ON "AdminAudit"("actorId", "createdAt");

CREATE TABLE "OpsExpense" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "amountRub" INTEGER NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'other',
    "note" TEXT NOT NULL DEFAULT '',
    "spentAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "User_trafficLinkId_idx" ON "User"("trafficLinkId");
CREATE INDEX "User_adminRole_idx" ON "User"("adminRole");
CREATE INDEX "User_blocked_idx" ON "User"("blocked");
CREATE INDEX "User_source_createdAt_idx" ON "User"("source", "createdAt");
