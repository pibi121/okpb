-- AlterTable
ALTER TABLE "QuickVideoRun" ADD COLUMN "characterIdsJson" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "QuickVideoRun" ADD COLUMN "refVideoUrl" TEXT NOT NULL DEFAULT '';
ALTER TABLE "QuickVideoRun" ADD COLUMN "refSlotsJson" TEXT NOT NULL DEFAULT '[]';
