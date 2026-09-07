-- CreateTable
CREATE TABLE "FunnelEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "platformUserId" TEXT NOT NULL DEFAULT '',
    "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dayIndex" INTEGER NOT NULL DEFAULT 0,
    "surface" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "stepTitle" TEXT NOT NULL,
    "stepDetail" TEXT NOT NULL DEFAULT '',
    "sourceKind" TEXT NOT NULL DEFAULT 'unknown',
    "sourceCode" TEXT NOT NULL DEFAULT '',
    "metaJson" TEXT NOT NULL DEFAULT '{}',
    CONSTRAINT "FunnelEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "FunnelEvent_userId_at_idx" ON "FunnelEvent"("userId", "at");

-- CreateIndex
CREATE INDEX "FunnelEvent_at_idx" ON "FunnelEvent"("at");

-- CreateIndex
CREATE INDEX "FunnelEvent_eventKey_at_idx" ON "FunnelEvent"("eventKey", "at");

-- CreateIndex
CREATE INDEX "FunnelEvent_sourceKind_sourceCode_at_idx" ON "FunnelEvent"("sourceKind", "sourceCode", "at");

-- CreateIndex
CREATE INDEX "FunnelEvent_surface_at_idx" ON "FunnelEvent"("surface", "at");
