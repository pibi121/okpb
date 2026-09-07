-- TG platform sync: publish templates & studio cast cards from Peach admin
ALTER TABLE "Character" ADD COLUMN "tgDisplayName" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Character" ADD COLUMN "tgCoverUrl" TEXT NOT NULL DEFAULT '';

ALTER TABLE "QuickVideoTemplate" ADD COLUMN "tgPublished" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "QuickVideoTemplate" ADD COLUMN "tgDisplayTitle" TEXT NOT NULL DEFAULT '';
ALTER TABLE "QuickVideoTemplate" ADD COLUMN "tgSortOrder" INTEGER NOT NULL DEFAULT 0;
CREATE INDEX "QuickVideoTemplate_tgPublished_tgSortOrder_idx" ON "QuickVideoTemplate"("tgPublished", "tgSortOrder");

ALTER TABLE "PhotoTemplate" ADD COLUMN "tgPublished" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "PhotoTemplate" ADD COLUMN "tgDisplayTitle" TEXT NOT NULL DEFAULT '';
CREATE INDEX "PhotoTemplate_tgPublished_sortOrder_idx" ON "PhotoTemplate"("tgPublished", "sortOrder");
