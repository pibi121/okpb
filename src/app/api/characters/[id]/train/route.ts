import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { refreshKreaLoraTrainStatus, startKreaLoraTrain } from "@/lib/krea-lora-train";
import { listCharacterPhotos, readTrainMeta } from "@/lib/character-dataset";

export const runtime = "nodejs";
/** Upload + SSH start can take several minutes on a slow link. */
export const maxDuration = 900;

type Ctx = { params: Promise<{ id: string }> };

const startSchema = z.object({
  triggerWord: z.string().min(3).max(32).optional(),
  epochs: z.number().int().min(4).max(20).optional(),
});

export async function GET(_req: NextRequest, ctx: Ctx) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });
  const { id } = await ctx.params;
  try {
    const { character, train } = await refreshKreaLoraTrainStatus({
      userId: user.id,
      characterId: id,
    });
    return NextResponse.json({
      character,
      train,
      photos: listCharacterPhotos(id),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    return NextResponse.json({ error: msg, train: readTrainMeta(id) }, { status: 400 });
  }
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });
  const { id } = await ctx.params;
  try {
    const body = startSchema.parse(await req.json().catch(() => ({})));
    const started = await startKreaLoraTrain({
      userId: user.id,
      characterId: id,
      triggerWord: body.triggerWord,
      epochs: body.epochs,
    });
    return NextResponse.json({
      ok: true,
      ...started,
      message: started.resumed
        ? `Обучение уже идёт на GPU — подключились к процессу (${started.slug}). Прогресс обновляется автоматически.`
        : `Krea2 LoRA train запущен на Metalnode. Оценка ~${started.estimateLabel} (${started.epochs} эпох). Прогресс обновляется автоматически; Comfy на время трейна остановится.`,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
