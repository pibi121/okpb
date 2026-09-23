-- AlterTable
ALTER TABLE "PaymentOrder" ADD COLUMN "remindCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "PaymentOrder" ADD COLUMN "lastRemindedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "PaymentOrder_status_remindCount_createdAt_idx" ON "PaymentOrder"("status", "remindCount", "createdAt");
