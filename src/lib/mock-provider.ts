import { prisma } from "./db";

const STEP_MS = Number(process.env.MOCK_JOB_STEP_MS || 1200);

const processing = new Set<string>();

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

/**
 * Заглушка генерации.
 * phase=preview → только картинки кадров
 * phase=animate|full → картинка + видео + склейка
 */
export async function processRenderJobMock(jobId: string) {
  if (processing.has(jobId)) return;
  processing.add(jobId);

  try {
    const job = await prisma.renderJob.findUnique({
      where: { id: jobId },
      include: { shots: { orderBy: { orderIndex: "asc" } } },
    });
    if (!job) return;
    if (["completed", "failed", "cancelled", "preview_ready"].includes(job.status)) {
      return;
    }

    const phase = job.phase || "full";
    const shots = job.shots.filter((s) => s.workflow !== "transition_only");
    const total = Math.max(shots.length, 1);

    await prisma.renderJob.update({
      where: { id: jobId },
      data: { status: "running_still", progress: 5 },
    });

    for (let i = 0; i < job.shots.length; i++) {
      const shot = job.shots[i];

      if (shot.workflow === "transition_only") {
        if (phase === "preview") continue;
        await prisma.shotJob.update({
          where: { id: shot.id },
          data: {
            status: "completed",
            resultUrl: `/api/mock-media?shot=${shot.id}&kind=transition`,
          },
        });
        continue;
      }

      await prisma.shotJob.update({
        where: { id: shot.id },
        data: { status: "running_still" },
      });
      await sleep(STEP_MS);

      const stillUrl = `/api/mock-media?shot=${shot.id}&kind=still`;
      await prisma.shotJob.update({
        where: { id: shot.id },
        data: {
          stillUrl,
          lastFrameUrl: stillUrl,
          status: phase === "preview" ? "preview_ready" : "running_video",
        },
      });

      await prisma.renderJob.update({
        where: { id: jobId },
        data: {
          progress: Math.round(((i + 0.4) / total) * (phase === "preview" ? 90 : 50)) + 5,
        },
      });

      if (phase === "preview") continue;

      await sleep(STEP_MS);
      await prisma.renderJob.update({
        where: { id: jobId },
        data: {
          status: "running_video",
          progress: Math.round(((i + 0.7) / total) * 85) + 10,
        },
      });

      if (shot.workflow === "still_i2v_audio") {
        await prisma.shotJob.update({
          where: { id: shot.id },
          data: { status: "running_audio" },
        });
        await sleep(Math.floor(STEP_MS / 2));
      }

      await prisma.shotJob.update({
        where: { id: shot.id },
        data: {
          status: "completed",
          resultUrl: `/api/mock-media?shot=${shot.id}&kind=clip`,
          lastFrameUrl: `/api/mock-media?shot=${shot.id}&kind=frame`,
        },
      });
    }

    if (phase === "preview") {
      await prisma.renderJob.update({
        where: { id: jobId },
        data: {
          status: "preview_ready",
          progress: 100,
          resultUrl: null,
        },
      });
      return;
    }

    await prisma.renderJob.update({
      where: { id: jobId },
      data: { status: "stitching", progress: 92 },
    });
    await sleep(STEP_MS);

    await prisma.renderJob.update({
      where: { id: jobId },
      data: {
        status: "completed",
        progress: 100,
        resultUrl: `/api/mock-media?job=${jobId}&kind=final`,
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Неизвестная ошибка заглушки";
    await prisma.renderJob.update({
      where: { id: jobId },
      data: { status: "failed", errorMessage: message },
    });
  } finally {
    processing.delete(jobId);
  }
}

export function enqueueMockJob(jobId: string) {
  setTimeout(() => {
    void processRenderJobMock(jobId);
  }, 50);
}

/** Перегенерация одного кадра превью внутри уже созданного job. */
export async function processShotRegenMock(jobId: string, shotId: string) {
  const key = `${jobId}:${shotId}`;
  if (processing.has(key)) return;
  processing.add(key);

  try {
    const shot = await prisma.shotJob.findFirst({
      where: { id: shotId, renderJobId: jobId },
    });
    if (!shot) return;

    await prisma.shotJob.update({
      where: { id: shotId },
      data: { status: "running_still" },
    });
    await sleep(STEP_MS);

    const stillUrl = `/api/mock-media?shot=${shotId}&kind=still&v=${Date.now()}`;
    await prisma.shotJob.update({
      where: { id: shotId },
      data: {
        stillUrl,
        lastFrameUrl: stillUrl,
        status: "preview_ready",
      },
    });

    const remaining = await prisma.shotJob.count({
      where: {
        renderJobId: jobId,
        workflow: { not: "transition_only" },
        status: { notIn: ["preview_ready", "completed"] },
      },
    });

    await prisma.renderJob.update({
      where: { id: jobId },
      data: {
        status: remaining === 0 ? "preview_ready" : "running_still",
        progress: remaining === 0 ? 100 : 60,
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Ошибка перегенерации";
    await prisma.shotJob.update({
      where: { id: shotId },
      data: { status: "failed" },
    });
    await prisma.renderJob.update({
      where: { id: jobId },
      data: { status: "preview_ready", errorMessage: message },
    });
  } finally {
    processing.delete(key);
  }
}

export function enqueueMockShotRegen(jobId: string, shotId: string) {
  setTimeout(() => {
    void processShotRegenMock(jobId, shotId);
  }, 50);
}
