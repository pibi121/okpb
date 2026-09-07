-- GPU orchestrator + deeper ops error cards

ALTER TABLE "OpsError" ADD COLUMN "stage" TEXT NOT NULL DEFAULT '';
ALTER TABLE "OpsError" ADD COLUMN "timelineJson" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "OpsError" ADD COLUMN "lastJobId" TEXT NOT NULL DEFAULT '';
ALTER TABLE "OpsError" ADD COLUMN "lastRefType" TEXT NOT NULL DEFAULT '';
ALTER TABLE "OpsError" ADD COLUMN "lastRefId" TEXT NOT NULL DEFAULT '';
ALTER TABLE "OpsError" ADD COLUMN "buildVersion" TEXT NOT NULL DEFAULT '';
ALTER TABLE "OpsError" ADD COLUMN "autoRetryCount" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "OpsSetting" ADD COLUMN "sloJson" TEXT NOT NULL DEFAULT '{}';
ALTER TABLE "OpsSetting" ADD COLUMN "gpuOrchestratorJson" TEXT NOT NULL DEFAULT '{}';

CREATE TABLE "GpuWorker" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'manual',
    "pool" TEXT NOT NULL DEFAULT 'any',
    "comfyUrl" TEXT NOT NULL DEFAULT '',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'unknown',
    "lastHeartbeatAt" DATETIME,
    "lastError" TEXT NOT NULL DEFAULT '',
    "currentJobId" TEXT,
    "costRubPerHour" INTEGER NOT NULL DEFAULT 55,
    "metaJson" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE UNIQUE INDEX "GpuWorker_key_key" ON "GpuWorker"("key");
CREATE INDEX "GpuWorker_enabled_status_idx" ON "GpuWorker"("enabled", "status");
CREATE INDEX "GpuWorker_pool_status_idx" ON "GpuWorker"("pool", "status");

CREATE TABLE "GpuJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL,
    "pool" TEXT NOT NULL DEFAULT 'any',
    "status" TEXT NOT NULL DEFAULT 'queued',
    "userId" TEXT,
    "refType" TEXT NOT NULL DEFAULT '',
    "refId" TEXT NOT NULL DEFAULT '',
    "workerId" TEXT,
    "stage" TEXT NOT NULL DEFAULT 'queued',
    "timelineJson" TEXT NOT NULL DEFAULT '[]',
    "error" TEXT,
    "queuedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    "waitMs" INTEGER,
    "runMs" INTEGER,
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "metaJson" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "GpuJob_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "GpuWorker" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "GpuJob_status_pool_queuedAt_idx" ON "GpuJob"("status", "pool", "queuedAt");
CREATE INDEX "GpuJob_workerId_status_idx" ON "GpuJob"("workerId", "status");
CREATE INDEX "GpuJob_refType_refId_idx" ON "GpuJob"("refType", "refId");
CREATE INDEX "GpuJob_kind_finishedAt_idx" ON "GpuJob"("kind", "finishedAt");
CREATE INDEX "GpuJob_userId_createdAt_idx" ON "GpuJob"("userId", "createdAt");
