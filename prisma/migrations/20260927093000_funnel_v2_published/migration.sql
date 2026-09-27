-- Funnel v2 bot catalog (Lab 2.0) — independent of tgPublished / Mini App
ALTER TABLE "PhotoTemplate" ADD COLUMN "funnelV2Published" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "QuickVideoTemplate" ADD COLUMN "funnelV2Published" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "LoraI2vTemplate" ADD COLUMN "funnelV2Published" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "PhotoTemplate_funnelV2Published_sortOrder_idx" ON "PhotoTemplate"("funnelV2Published", "sortOrder");
CREATE INDEX "QuickVideoTemplate_funnelV2Published_tgSortOrder_idx" ON "QuickVideoTemplate"("funnelV2Published", "tgSortOrder");
CREATE INDEX "LoraI2vTemplate_funnelV2Published_tgSortOrder_idx" ON "LoraI2vTemplate"("funnelV2Published", "tgSortOrder");
