/**
 * Keep one Gellai Tomphy quick-video generation.
 */
import { PrismaClient } from "@prisma/client";
import { comfyBaseUrl } from "../src/lib/metalnode-config.ts";

const p = new PrismaClient();
const GELLAI_RUN = "cmtfwlnka001jv99gryexokul";
const GELLAI_GALLERY = "cmtfwtho90003v9g48wnoy8x0";
const STALE_ERROR_GALLERY = "cmtfwthlq0001v9g4qidr3ggc";

async function main() {
  const deleted = await p.galleryItem.deleteMany({
    where: { id: STALE_ERROR_GALLERY },
  });
  console.log(`Deleted stale error gallery items: ${deleted.count}`);

  try {
    const res = await fetch(`${comfyBaseUrl()}/queue`, {
      signal: AbortSignal.timeout(15_000),
    });
    if (res.ok) {
      const before = await res.json();
      const runN = before.queue_running?.length || 0;
      const pendN = before.queue_pending?.length || 0;
      console.log(`Comfy before: running=${runN} pending=${pendN}`);
      if (pendN > 0) {
        await fetch(`${comfyBaseUrl()}/queue`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clear: true }),
          signal: AbortSignal.timeout(15_000),
        });
        console.log("Cleared Comfy pending queue");
      }
    }
  } catch (e) {
    console.warn("Comfy queue cleanup skipped:", e instanceof Error ? e.message : e);
  }

  const item = await p.galleryItem.findUnique({ where: { id: GELLAI_GALLERY } });
  if (item) {
    let meta = {};
    try {
      meta = JSON.parse(item.metaJson || "{}");
    } catch {
      /* ignore */
    }
    await p.galleryItem.update({
      where: { id: GELLAI_GALLERY },
      data: {
        metaJson: JSON.stringify({
          ...meta,
          gpuEnqueuedAt: new Date().toISOString(),
          singleRun: true,
        }),
      },
    });
  }

  const run = await p.quickVideoRun.findUnique({ where: { id: GELLAI_RUN } });
  console.log(JSON.stringify({ keptRun: run?.id, status: run?.status }, null, 2));
  await p.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
