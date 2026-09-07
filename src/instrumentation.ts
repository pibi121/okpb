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
      }, 30_000);
    })
    .catch((e) => console.error("[peach] gpu workers boot:", e));

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
        const stuck = await prisma.gpuJob.updateMany({
          where: {
            status: { in: ["queued", "assigned", "running"] },
            updatedAt: { lt: new Date(Date.now() - 45 * 60 * 1000) },
          },
          data: {
            status: "error",
            stage: "error",
            error: "orphaned after process restart — check recover / retry",
            finishedAt: new Date(),
          },
        });
        if (stuck.count > 0) {
          console.log(`[peach] gpu jobs: marked ${stuck.count} orphaned`);
        }
      } catch (e) {
        console.error("[peach] gpu job orphan sweep:", e);
      }
    })();
  }, 20_000);
}
