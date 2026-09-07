import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  composePhotoPromptLLM,
  composeVideoPromptLLM,
} from "@/lib/prompt-composer-llm";
import { ollamaUnload } from "@/lib/ollama-client";

export const runtime = "nodejs";
export const maxDuration = 180;

const photoSchema = z.object({
  kind: z.literal("photo"),
  characterId: z.string().optional().nullable(),
  characterIds: z.array(z.string()).optional(),
  poseId: z.string().optional(),
  styleId: z.string().optional(),
  userNote: z.string().optional(),
  includeMale: z.boolean().optional(),
  clothed: z.boolean().optional(),
  pokies: z.boolean().optional(),
  usePreset: z.boolean().optional(),
});

const videoSchema = z.object({
  kind: z.literal("video"),
  stillId: z.string().optional(),
  stillPrompt: z.string().optional(),
  stillTitle: z.string().optional().nullable(),
  userNote: z.string().optional(),
  poseId: z.string().optional().nullable(),
  durationSec: z.number().optional(),
  dialogue: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });

  const body = await req.json();
  try {
    if (body?.kind === "photo") {
      const data = photoSchema.parse(body);
      const prompt = await composePhotoPromptLLM(data);
      await ollamaUnload();
      return NextResponse.json({ prompt });
    }
    if (body?.kind === "video") {
      const data = videoSchema.parse(body);
      let stillPrompt = data.stillPrompt || "";
      let stillTitle = data.stillTitle || null;
      let poseId = data.poseId || null;
      if (data.stillId) {
        const still = await prisma.galleryItem.findFirst({
          where: { id: data.stillId, userId: user.id, kind: "photo" },
        });
        if (!still) return NextResponse.json({ error: "still not found" }, { status: 404 });
        stillPrompt = still.prompt || stillPrompt;
        stillTitle = still.title;
        try {
          const meta = JSON.parse(still.metaJson || "{}") as { poseId?: string };
          poseId = poseId || meta.poseId || null;
        } catch {
          /* ignore */
        }
      }
      const prompt = await composeVideoPromptLLM({
        stillPrompt,
        userNote: data.userNote,
        stillTitle,
        poseId,
        durationSec: data.durationSec,
        dialogue: data.dialogue,
      });
      await ollamaUnload();
      return NextResponse.json({ prompt, poseId });
    }
    return NextResponse.json({ error: "unknown kind" }, { status: 400 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
