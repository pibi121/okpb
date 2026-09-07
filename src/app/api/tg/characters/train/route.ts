import { NextResponse } from "next/server";
import { resolveTgApiUserId } from "@/lib/tg/resolve-api-user";
import { prisma } from "@/lib/db";
import {
  refreshKreaLoraTrainStatus,
  startKreaLoraTrain,
} from "@/lib/krea-lora-train";
import { notifyTgLoraTrainingComplete } from "@/lib/tg/lora-onboard";
import { buildTgTrainProgress } from "@/lib/tg/train-progress";
import { readTrainMeta } from "@/lib/character-dataset";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Refresh GPU train status + return progress for Mini App. */
export async function GET(req: Request) {
  const userId = await resolveTgApiUserId(req);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const characterId = new URL(req.url).searchParams.get("characterId") || "";
  if (!characterId) {
    return NextResponse.json({ error: "characterId required" }, { status: 400 });
  }

  const ch = await prisma.character.findFirst({
    where: { id: characterId, userId, videoRefOnly: false },
  });
  if (!ch) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  if (ch.loraStatus === "lora_training") {
    try {
      await refreshKreaLoraTrainStatus({ userId, characterId });
      await notifyTgLoraTrainingComplete(characterId);
    } catch (e) {
      console.error("[tg-train-status]", characterId, e);
    }

    // If Mini App shows «training» but GPU job never started / died, kick it again.
    const after = await prisma.character.findFirst({
      where: { id: characterId, userId },
      select: { loraStatus: true },
    });
    if (after?.loraStatus === "lora_training") {
      const meta = readTrainMeta(characterId);
      const startedMs = meta.startedAt
        ? Date.now() - new Date(meta.startedAt).getTime()
        : Number.POSITIVE_INFINITY;
      const staleUpload =
        meta.status === "error" ||
        meta.status === "idle" ||
        !meta.status ||
        (meta.status === "uploading" && startedMs > 8 * 60_000);
      if (staleUpload) {
        try {
          await startKreaLoraTrain({ userId, characterId });
        } catch (e) {
          console.error("[tg-train-status] restart:", characterId, e);
        }
      }
    }
  }

  const fresh = await prisma.character.findFirst({
    where: { id: characterId, userId },
    select: { loraStatus: true },
  });

  const loraStatus = fresh?.loraStatus || ch.loraStatus;
  return NextResponse.json({
    characterId,
    loraStatus,
    train: buildTgTrainProgress(characterId, loraStatus),
  });
}
