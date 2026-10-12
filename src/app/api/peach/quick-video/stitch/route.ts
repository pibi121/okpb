import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { backupDatabase, saveGalleryBinary } from "@/lib/local-store";
import { localBytesFromResultUrl } from "@/lib/peach-lab";
import { stitchClipBuffersWithFallback } from "@/lib/stitch-fallback";
import { serializeStoryH3Template } from "@/lib/story-h3-prompt";
import { getQuickVideoRun } from "@/lib/quick-video";

export const runtime = "nodejs";
export const maxDuration = 300;

const schema = z.object({
  runIds: z.array(z.string().min(1)).min(2).max(6),
  title: z.string().max(120).optional(),
  /** Optional full H3 dump to store on the stitch run for template save. */
  prompt: z.string().max(24000).optional(),
});

export async function POST(req: NextRequest) {
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

    const durationSec = Math.min(
      120,
      Math.max(
        4,
        ordered.reduce((sum, r) => sum + (r!.durationSec || 0), 0) || 8,
      ),
    );
    const orientation = ordered[0]!.orientation || "9_16";
    const width = stitched.width || ordered[0]!.width || 720;
    const height = stitched.height || ordered[0]!.height || 1280;

    const title =
      body.title?.trim() ||
      `Мини-фильм · склейка ${ordered.length} шотов`;

    const promptStored =
      body.prompt?.trim() && body.prompt.trim().length >= 40
        ? body.prompt.trim()
        : serializeStoryH3Template({
            prompt: [
              "subject_definitions:",
              "<Picture 1> identity hero 1; <Picture 2> identity hero 2.",
              "",
              "summary:",
              `[reference generation] Stitched ${ordered.length}-shot mini-film.`,
              "",
              "retention_analysis:",
              "Identity subjects: fully_preserved.",
              "",
              "detailed_description:",
              ordered
                .map(
                  (r, i) =>
                    `[Shot ${i + 1}] From lab run ${r!.id} (${r!.durationSec}s).`,
                )
                .join("\n\n"),
              "",
              "overall_soundscape:",
              "Natural scene ambience.",
              "",
              "non_diegetic_music:",
              "N/A",
            ].join("\n"),
            totalDurationSec: Math.min(12, durationSec),
          });

    const first = ordered[0]!;
    const run = await prisma.quickVideoRun.create({
      data: {
        userId: user.id,
        title,
        prompt: promptStored.startsWith("{")
          ? (() => {
              try {
                const j = JSON.parse(promptStored) as { prompt?: string };
                return typeof j.prompt === "string" ? j.prompt : promptStored;
              } catch {
                return promptStored;
              }
            })()
          : promptStored,
        composedPrompt: first.composedPrompt || promptStored,
        characterIdsJson: first.characterIdsJson,
        refImageUrlsJson: first.refImageUrlsJson,
        refVideoUrl: first.refVideoUrl || "",
        refSlotsJson: first.refSlotsJson,
        orientation,
        durationSec: Math.min(12, durationSec),
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
        prompt: run.composedPrompt || run.prompt,
        resultUrl: saved.publicUrl,
        width,
        height,
        metaJson: JSON.stringify({
          status: "ready",
          jobAction: "mini_film_stitch",
          storyH3: true,
          quickVideoRunId: run.id,
          sourceRunIds: body.runIds,
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
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
