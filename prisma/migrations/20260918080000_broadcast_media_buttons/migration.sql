-- AlterTable
ALTER TABLE "Broadcast" ADD COLUMN "mediaJson" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "Broadcast" ADD COLUMN "buttonsJson" TEXT NOT NULL DEFAULT '[]';
