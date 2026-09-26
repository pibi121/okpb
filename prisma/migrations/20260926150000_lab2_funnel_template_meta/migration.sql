-- Lab 2.0 funnel meta: photo teaser + animate prompts; story H3 scene categories
ALTER TABLE "PhotoTemplate" ADD COLUMN IF NOT EXISTS "previewVideoUrl" TEXT NOT NULL DEFAULT '';
ALTER TABLE "PhotoTemplate" ADD COLUMN IF NOT EXISTS "animateJson" TEXT NOT NULL DEFAULT '';
ALTER TABLE "QuickVideoTemplate" ADD COLUMN IF NOT EXISTS "sceneCategory" TEXT NOT NULL DEFAULT '';
