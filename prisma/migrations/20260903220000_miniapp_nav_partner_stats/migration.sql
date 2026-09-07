-- Mini-app catalog + partner per-link purchase stats
ALTER TABLE "PhotoTemplate" ADD COLUMN "sceneCategory" TEXT NOT NULL DEFAULT '';
ALTER TABLE "PhotoTemplate" ADD COLUMN "previewIdentityKey" TEXT NOT NULL DEFAULT '';
ALTER TABLE "QuickVideoTemplate" ADD COLUMN "previewIdentityKey" TEXT NOT NULL DEFAULT '';
ALTER TABLE "PartnerLink" ADD COLUMN "purchases" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "PartnerLink" ADD COLUMN "purchaseGrossPeaches" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "PartnerLink" ADD COLUMN "commissionPeaches" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "PartnerCommission" ADD COLUMN "linkId" TEXT;
