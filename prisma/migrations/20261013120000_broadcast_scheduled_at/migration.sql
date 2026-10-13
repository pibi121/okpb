-- AlterTable
ALTER TABLE "Broadcast" ADD COLUMN "scheduledAt" DATETIME;

-- CreateIndex
CREATE INDEX "Broadcast_status_scheduledAt_idx" ON "Broadcast"("status", "scheduledAt");
