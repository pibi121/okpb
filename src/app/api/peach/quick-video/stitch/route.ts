import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { backupDatabase, saveGalleryBinary } from "@/lib/local-store";
import { localBytesFromResultUrl } from "@/lib/peach-lab";
import { stitchClipBuffersWithFallback } from "@/lib/stitch-fallback";
import {
  clampStoryShotSec,
  MAX_STORY_H3_SHOTS,
  normalizeStoryH3Shots,
  serializeStoryH3Template,
  sumStoryH3ShotsSec,
} from "@/lib/story-h3-prompt";
import { getQuickVideoRun } from "@/lib/quick-video";
import { maintenanceApiBlock } from "@/lib/ops/maintenance-api";

export const runtime = "nodejs";
export const maxDuration = 300;

const schema = z.object({
  runIds: z.array(z.string().min(1)).min(2).max(MAX_STORY_H3_SHOTS),
  title: z.string().max(120).optional(),
  /** Optional full-film H3 dump (shared subject/summary); shots carry per-clip prompts. */
  prompt: z.string().max(24000).optional(),
  /** Lab shot prompts + durations — required for Funnel multi-shot regenerate. */
  shots: z
    .array(
      z.object({
        durationSec: z.number().min(1).max(12),
        prompt: z.string().min(8).max(24000),
      }),
    )
    .min(2)
    .max(MAX_STORY_H3_SHOTS)
    .optional(),
});

/** Restore Lab shot rows from a previous stitch (sourceRunIds + storyShots). */
export async function GET(req: NextRequest) {
  const maintenanceBlock = await maintenanceApiBlock();
  if (maintenanceBlock) return maintenanceBlock;

  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });

  const runId = (req.nextUrl.searchParams.get("runId") || "").trim();
  if (!runId) {
    return NextResponse.json({ error: "runId required" }, { status: 400 });
  }

  const run = await prisma.quickVideoRun.findFirst({
    where: { id: runId, userId: user.id },
  });
  if (!run) {
    return NextResponse.json({ error: "run not found" }, { status: 404 });
  }

  let sourceRunIds: string[] = [];
  let storyShots: Array<{ durationSec: number; prompt: string }> | undefined;
  if (run.galleryItemId) {
    const item = await prisma.galleryItem.findUnique({
      where: { id: run.galleryItemId },
      select: { metaJson: true },
    });
    try {
      const meta = JSON.parse(item?.metaJson || "{}") as {
        sourceRunIds?: unknown;
        storyShots?: unknown;
      };
      if (Array.isArray(meta.sourceRunIds)) {
        sourceRunIds = meta.sourceRunIds
          .filter((id): id is string => typeof id === "string" && !!id)
          .slice(0, MAX_STORY_H3_SHOTS);
      }
      storyShots = normalizeStoryH3Shots(meta.storyShots);
    } catch {
      /* ignore */
    }
  }

  if (!sourceRunIds.length) {
    return NextResponse.json(
      { error: "у этой склейки нет sourceRunIds — восстановить шоты нельзя" },
      { status: 400 },
    );
  }

  const clipRuns = await prisma.quickVideoRun.findMany({
    where: { userId: user.id, id: { in: sourceRunIds } },
  });
  const byId = new Map(clipRuns.map((r) => [r.id, r]));

  const shots = sourceRunIds.map((id, i) => {
    const clip = byId.get(id);
    const fromMeta = storyShots?.[i];
    let prompt =
      (fromMeta?.prompt || "").trim() ||
      (clip?.composedPrompt || clip?.prompt || "").trim();
    if (prompt.startsWith('{"__storyH3"')) {
      try {
        const j = JSON.parse(prompt) as { prompt?: string };
        if (typeof j.prompt === "string") prompt = j.prompt.trim();
      } catch {
        /* keep */
      }
    }
    return {
      runId: id,
      durationSec: clampStoryShotSec(
        fromMeta?.durationSec ?? clip?.durationSec ?? 6,
      ),
      prompt: prompt || `Shot ${i + 1}`,
      status: clip?.status || "missing",
      resultVideoUrl: clip?.resultVideoUrl || null,
    };
  });

  return NextResponse.json({
    stitchRunId: run.id,
    title: run.title,
    sourceRunIds,
    shots,
  });
}

export async function POST(req: NextRequest) {
  const maintenanceBlock = await maintenanceApiBlock();
  if (maintenanceBlock) return maintenanceBlock;

  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });

  try {
    const body = schema.parse(await req.json());
    const runs = await prisma.quickVideoRun.findMany({
      where: { userId: user.id, id: { in: body.runIds } },
    });
    const byId = new Map(runs.map((r) => [r.id, r]));
    const ordered = body.runIds.map((id) => byId.get(id)).filter(Boolean);
    if (ordered.length !== body.runIds.length) {
      return NextResponse.json(
        { error: "Не все runIds найдены (только свои ready-прогоны)" },
        { status: 400 },
      );
    }
    for (const r of ordered) {
      if (r!.status !== "ready" || !r!.resultVideoUrl) {
        return NextResponse.json(
          { error: `Прогон ${r!.id} ещё не ready` },
          { status: 400 },
        );
      }
    }

    const clips: Buffer[] = [];
    for (const r of ordered) {
      const bytes = localBytesFromResultUrl(r!.resultVideoUrl);
      if (!bytes?.length) {
        return NextResponse.json(
          { error: `Нет файла видео для ${r!.id}` },
          { status: 400 },
        );
      }
      clips.push(bytes);
    }

    const stitched = await stitchClipBuffersWithFallback({
      clips,
      tag: "mini_film",
    });
    const saved = saveGalleryBinary(
      user.id,
      "mp4",
      stitched.bytes,
      "mini_film_stitch",
    );

    const clientShots = normalizeStoryH3Shots(body.shots);
    const shots =
      clientShots && clientShots.length === ordered.length
        ? clientShots
        : ordered.map((r, i) => ({
            durationSec: clampStoryShotSec(r!.durationSec || 6),
            prompt:
              (clientShots?.[i]?.prompt || "").trim() ||
              (r!.composedPrompt || r!.prompt || "").trim() ||
              `Shot ${i + 1}`,
          }));

    const durationSec = sumStoryH3ShotsSec(shots);
    const orientation = ordered[0]!.orientation || "9_16";
    const width = stitched.width || ordered[0]!.width || 720;
    const height = stitched.height || ordered[0]!.height || 1280;

    const title =
      body.title?.trim() ||
      `Мини-фильм · склейка ${ordered.length} шотов`;

    const filmPrompt =
      body.prompt?.trim() && body.prompt.trim().length >= 40
        ? body.prompt.trim()
        : [
            "subject_definitions:",
            "<Picture 1> identity hero 1; <Picture 2> identity hero 2.",
            "",
            "summary:",
            `[reference generation] Stitched ${ordered.length}-shot mini-film (${durationSec}s).`,
            "",
            "retention_analysis:",
            "Identity subjects: fully_preserved.",
            "",
            "detailed_description:",
            "High-quality cinematic realism with stable identity across shots.",
            "",
            "overall_soundscape:",
            "Natural scene ambience.",
            "",
            "non_diegetic_music:",
            "N/A",
          ].join("\n");

    const promptStored = serializeStoryH3Template({
      prompt: filmPrompt,
      totalDurationSec: durationSec,
      shots,
    });

    const first = ordered[0]!;
    const run = await prisma.quickVideoRun.create({
      data: {
        userId: user.id,
        title,
        prompt: promptStored,
        composedPrompt: first.composedPrompt || filmPrompt,
        characterIdsJson: first.characterIdsJson,
        refImageUrlsJson: first.refImageUrlsJson,
        refVideoUrl: first.refVideoUrl || "",
        refSlotsJson: first.refSlotsJson,
        orientation,
        durationSec,
        width,
        height,
        status: "ready",
        resultVideoUrl: saved.publicUrl,
        engine: stitched.engine,
      },
    });

    const item = await prisma.galleryItem.create({
      data: {
        userId: user.id,
        kind: "video",
        title,
        prompt: filmPrompt,
        resultUrl: saved.publicUrl,
        width,
        height,
        metaJson: JSON.stringify({
          status: "ready",
          jobAction: "mini_film_stitch",
          storyH3: true,
          quickVideoRunId: run.id,
          sourceRunIds: body.runIds,
          storyShots: shots,
          durationSec,
          engine: stitched.engine,
          localKey: saved.relKey,
        }),
      },
    });

    await prisma.quickVideoRun.update({
      where: { id: run.id },
      data: { galleryItemId: item.id },
    });
    backupDatabase("mini-film-stitch");

    const publicRun = await getQuickVideoRun(user.id, run.id);
    return NextResponse.json({
      run: publicRun,
      item: { id: item.id, resultUrl: saved.publicUrl },
      engine: stitched.engine,
      durationSec,
      shotCount: shots.length,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
