export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  void import("@/lib/ops/seed")
    .then(({ bootOps }) => bootOps())
    .catch(() => undefined);

  // Seed GPU worker registry + periodic heartbeat for /ops/load.
  void import("@/lib/gpu/workers")
    .then(async ({ ensurePlaceholderWorkers, heartbeatAllWorkers }) => {
      await ensurePlaceholderWorkers();
      await heartbeatAllWorkers().catch(() => undefined);
      setInterval(() => {
        void heartbeatAllWorkers().catch(() => undefined);
      }, 10_000);
    })
    .catch((e) => console.error("[peach] gpu workers boot:", e));

  // Keep Railway volume from filling up (gallery videos).
  void import("@/lib/disk-hygiene")
    .then(({ diskAlmostFull, freeGalleryDisk }) => {
      const tick = () => {
        try {
          if (diskAlmostFull()) {
            const r = freeGalleryDisk({ emergency: false, targetFreeMb: 90 });
            if (r.deleted) {
              console.warn(
                `[peach] disk hygiene: deleted ${r.deleted}, freed ${Math.round(r.freed / 1024 / 1024)}MB`,
              );
            }
          }
        } catch (e) {
          console.error("[peach] disk hygiene:", e);
        }
      };
      setTimeout(tick, 25_000);
      setInterval(tick, 10 * 60_000);
    })
    .catch(() => undefined);

  // Always try to pull finished Comfy outputs for busy/error runs (cheap download).
  // Delay so the Railway SSH tunnel to Comfy is up before we probe/download.
  // Full GPU re-queue only when PEACH_RESUME_QV=1 (can OOM small Railway boxes).
  setTimeout(() => {
    void (async () => {
      try {
        const { resumeStuckQuickVideoRuns } = await import("@/lib/quick-video");
        const allowRequeue = process.env.PEACH_RESUME_QV === "1";
        const n = await resumeStuckQuickVideoRuns({ allowRequeue });
        console.log(
          `[peach] quick-video startup: handled ${n} stuck run(s) (requeue=${allowRequeue})`,
        );
      } catch (e) {
        console.error(
          "[peach] quick-video startup resume failed:",
          e instanceof Error ? e.message : e,
        );
      }

      try {
        const { resumePendingLoraI2vJobs } = await import(
          "@/lib/tg/generation-service"
        );
        const n = await resumePendingLoraI2vJobs();
        if (n > 0) {
          console.log(`[peach] lora_i2v startup: resumed ${n} pending job(s)`);
        }
      } catch (e) {
        console.error(
          "[peach] lora_i2v startup resume failed:",
          e instanceof Error ? e.message : e,
        );
      }

      // Mark orphaned running GpuJobs after redeploy (process memory gone).
      try {
        const { prisma } = await import("@/lib/db");
        const { sweepStaleGpuJobs } = await import("@/lib/gpu/worker-admin");
        const stale = await sweepStaleGpuJobs();
        // Also catch ledger rows left after redeploy with no live process.
        const orphans = await prisma.gpuJob.updateMany({
          where: {
            status: { in: ["queued", "assigned", "running"] },
            updatedAt: { lt: new Date(Date.now() - 12 * 60 * 1000) },
          },
          data: {
            status: "error",
            stage: "error",
            error: "orphaned after process restart — check recover / retry",
            finishedAt: new Date(),
          },
        });
        if (stale > 0 || orphans.count > 0) {
          console.log(
            `[peach] gpu jobs: stale=${stale} orphaned=${orphans.count}`,
          );
        }
        await prisma.gpuWorker.updateMany({
          where: { currentJobId: { not: null } },
          data: { currentJobId: null, status: "online" },
        });
      } catch (e) {
        console.error("[peach] gpu job orphan sweep:", e);
      }
    })();
  }, 20_000);
}
