-- Look packs: 5 poses, one price, published flag hides the bot section until the first publish.
CREATE TABLE "FunnelLookPack" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "tgDisplayTitle" TEXT NOT NULL DEFAULT '',
    "pricePeaches" INTEGER NOT NULL DEFAULT 270,
    "previewVideoUrl" TEXT NOT NULL DEFAULT '',
    "scenesJson" TEXT NOT NULL DEFAULT '[]',
    "funnelV2Published" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FunnelLookPack_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FunnelLookPack_funnelV2Published_sortOrder_idx" ON "FunnelLookPack"("funnelV2Published", "sortOrder");
