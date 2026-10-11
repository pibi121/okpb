-- Funnel v2 keyboard: per-button row + color, catalog page sizes
ALTER TABLE "PhotoTemplate" ADD COLUMN "tgButtonStyle" TEXT NOT NULL DEFAULT '';
ALTER TABLE "PhotoTemplate" ADD COLUMN "tgRowBreak" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "QuickVideoTemplate" ADD COLUMN "tgButtonStyle" TEXT NOT NULL DEFAULT '';
ALTER TABLE "QuickVideoTemplate" ADD COLUMN "tgRowBreak" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "LoraI2vTemplate" ADD COLUMN "tgButtonStyle" TEXT NOT NULL DEFAULT '';
ALTER TABLE "LoraI2vTemplate" ADD COLUMN "tgRowBreak" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "OpsSetting" ADD COLUMN "funnelV2KeyboardJson" TEXT NOT NULL DEFAULT '';
