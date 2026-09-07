import { after } from "next/server";
import { prisma } from "@/lib/db";
import { backupDatabase, saveGalleryBinary } from "@/lib/local-store";
import { composePhotoPromptLLM } from "@/lib/prompt-composer-llm";
import { ollamaUnload } from "@/lib/ollama-client";
import { generatePhotoBytes } from "@/lib/peach-lab";

export type CharacterMode = "none" | "lookbook" | "lora";

export type TesterCreateInput = {
  userId: string;
  title?: string;
  characterMode: CharacterMode;
  characterIds?: string[];
  poseOn: boolean;
  poseId?: string;
  styleOn: boolean;
  styleId?: string;
  userNote?: string;
  variationCount?: number;
  width?: number;
  height?: number;
  skinDetail?: boolean;
  skinDetailStrength?: number;
};

function parseAxis(v: unknown): number | null {
  if (v === 1 || v === -1) return v;
  if (v === "+1" || v === "+") return 1;
  if (v === "-1" || v === "-") return -1;
  return null;
}

export function summarizeSessions(
  sessions: Array<{
    characterMode: string;
    poseOn: boolean;
    poseId: string | null;
    styleOn: boolean;
    styleId: string | null;
    variants: Array<{
      status: string;
      quality: number | null;
      face: number | null;
      promptFit: number | null;
      poseFit: number | null;
    }>;
  }>,
) {
  type Bucket = {
    key: string;
    n: number;
    quality: { plus: number; rated: number };
    face: { plus: number; rated: number };
    promptFit: { plus: number; rated: number };
    poseFit: { plus: number; rated: number };
  };
  const map = new Map<string, Bucket>();

  for (const s of sessions) {
    const key = [
      s.characterMode,
      s.poseOn ? s.poseId || "pose" : "no-pose",
      s.styleOn ? s.styleId || "style" : "no-style",
    ].join(" · ");
    let b = map.get(key);
    if (!b) {
      b = {
        key,
        n: 0,
        quality: { plus: 0, rated: 0 },
        face: { plus: 0, rated: 0 },
        promptFit: { plus: 0, rated: 0 },
        poseFit: { plus: 0, rated: 0 },
      };
      map.set(key, b);
    }
    for (const v of s.variants) {
      if (v.status !== "ready") continue;
      b.n += 1;
      const axes = [
        ["quality", v.quality] as const,
        ["face", v.face] as const,
        ["promptFit", v.promptFit] as const,
        ["poseFit", v.poseFit] as const,
      ];
      for (const [name, val] of axes) {
        if (val !== 1 && val !== -1) continue;
        b[name].rated += 1;
        if (val === 1) b[name].plus += 1;
      }
    }
  }

  return [...map.values()].map((b) => ({
    key: b.key,
    variants: b.n,
    qualityPct: b.quality.rated ? Math.round((100 * b.quality.plus) / b.quality.rated) : null,
    facePct: b.face.rated ? Math.round((100 * b.face.plus) / b.face.rated) : null,
    promptPct: b.promptFit.rated
      ? Math.round((100 * b.promptFit.plus) / b.promptFit.rated)
      : null,
    posePct: b.poseFit.rated ? Math.round((100 * b.poseFit.plus) / b.poseFit.rated) : null,
    rated: {
      quality: b.quality.rated,
      face: b.face.rated,
      promptFit: b.promptFit.rated,
      poseFit: b.poseFit.rated,
    },
  }));
}

export async function enqueueTesterSession(input: TesterCreateInput) {
  const n = Math.min(Math.max(input.variationCount ?? 3, 2), 4);
  const characterIds =
    input.characterMode === "none" ? [] : [...new Set(input.characterIds || [])];
  if (input.characterMode !== "none" && !characterIds.length) {
    throw new Error("Выбери персонажа или режим «без персонажа»");
  }

  const width = input.width ?? 888;
  const height = input.height ?? 1176;
  const session = await prisma.testSession.create({
    data: {
      userId: input.userId,
      title: input.title || `Test · ${input.characterMode}`,
      characterMode: input.characterMode,
      characterIdsJson: JSON.stringify(characterIds),
      poseOn: !!input.poseOn,
      poseId: input.poseOn ? input.poseId || null : null,
      styleOn: !!input.styleOn,
      styleId: input.styleOn ? input.styleId || null : null,
      userNote: input.userNote?.trim() || "",
      variationCount: n,
      width,
      height,
      status: "pending",
    },
  });

  const seeds = Array.from({ length: n }, () =>
    Math.floor(Math.random() * 1e15),
  );
  await prisma.testVariant.createMany({
    data: seeds.map((seed, index) => ({
      sessionId: session.id,
      index,
      seed: String(seed),
      status: "pending",
    })),
  });

  backupDatabase("tester-pending");
  after(() => {
    void runTesterSession(session.id, input.userId, {
      skinDetail: input.skinDetail,
      skinDetailStrength: input.skinDetailStrength,
    });
  });
  return prisma.testSession.findUniqueOrThrow({
    where: { id: session.id },
    include: { variants: { orderBy: { index: "asc" } } },
  });
}

async function runTesterSession(
  sessionId: string,
  userId: string,
  skinOpts?: { skinDetail?: boolean; skinDetailStrength?: number },
) {
  const session = await prisma.testSession.findFirst({
    where: { id: sessionId, userId },
    include: { variants: { orderBy: { index: "asc" } } },
  });
  if (!session) return;

  try {
    const characterIds = JSON.parse(session.characterIdsJson || "[]") as string[];
    const useCharacterLora = session.characterMode === "lora";
    const poseId = session.poseOn ? session.poseId || undefined : undefined;
    const styleId = session.styleOn ? session.styleId || undefined : undefined;

    const composedPrompt = await composePhotoPromptLLM({
      characterIds: session.characterMode === "none" ? [] : characterIds,
      poseId,
      styleId,
      userNote: session.userNote || undefined,
      usePreset: session.poseOn || session.styleOn,
    });
    await ollamaUnload();

    await prisma.testSession.update({
      where: { id: sessionId },
      data: { composedPrompt },
    });

    for (const variant of session.variants) {
      try {
        const seed = Number(variant.seed);
        const out = await generatePhotoBytes({
          userId,
          characterIds: session.characterMode === "none" ? [] : characterIds,
          characterId: characterIds[0] || null,
          title: `${session.title || "Test"} #${variant.index + 1}`,
          poseId,
          styleId,
          userNote: session.userNote || undefined,
          usePreset: session.poseOn || session.styleOn,
          width: session.width,
          height: session.height,
          composedPrompt,
          seed,
          useCharacterLora,
          skinDetail: skinOpts?.skinDetail,
          skinDetailStrength: skinOpts?.skinDetailStrength,
        });
        const saved = saveGalleryBinary(userId, "png", out.bytes, "test");
        await prisma.testVariant.update({
          where: { id: variant.id },
          data: {
            status: "ready",
            resultUrl: saved.publicUrl,
            engine: out.engine,
            error: null,
          },
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "ошибка вариации";
        console.error("[peach] tester variant failed:", e);
        await prisma.testVariant.update({
          where: { id: variant.id },
          data: { status: "error", error: msg },
        });
      }
    }

    const left = await prisma.testVariant.count({
      where: { sessionId, status: "pending" },
    });
    const anyReady = await prisma.testVariant.count({
      where: { sessionId, status: "ready" },
    });
    await prisma.testSession.update({
      where: { id: sessionId },
      data: {
        status: anyReady ? "ready" : left ? "pending" : "error",
        error: anyReady ? null : "все вариации упали",
      },
    });
    backupDatabase("tester-ready");
  } catch (e) {
    const msg = e instanceof Error ? e.message : "ошибка сессии";
    console.error("[peach] tester session failed:", e);
    await prisma.testSession.update({
      where: { id: sessionId },
      data: { status: "error", error: msg },
    });
    await prisma.testVariant.updateMany({
      where: { sessionId, status: "pending" },
      data: { status: "error", error: msg },
    });
    backupDatabase("tester-error");
  }
}

export async function rateTesterVariant(
  userId: string,
  variantId: string,
  ratings: {
    quality?: unknown;
    face?: unknown;
    promptFit?: unknown;
    poseFit?: unknown;
    note?: string;
  },
) {
  const variant = await prisma.testVariant.findFirst({
    where: { id: variantId, session: { userId } },
    include: { session: true },
  });
  if (!variant) throw new Error("variant not found");

  const faceNa = variant.session.characterMode === "none";
  const poseNa = !variant.session.poseOn;

  const data: {
    quality?: number | null;
    face?: number | null;
    promptFit?: number | null;
    poseFit?: number | null;
    note?: string;
  } = {};

  if ("quality" in ratings) data.quality = parseAxis(ratings.quality);
  if ("face" in ratings) data.face = faceNa ? null : parseAxis(ratings.face);
  if ("promptFit" in ratings) data.promptFit = parseAxis(ratings.promptFit);
  if ("poseFit" in ratings) {
    data.poseFit = poseNa ? null : parseAxis(ratings.poseFit);
  }
  if (typeof ratings.note === "string") data.note = ratings.note.trim();

  await prisma.testVariant.update({
    where: { id: variantId },
    data,
  });
  backupDatabase("tester-rate");
  return prisma.testVariant.findUniqueOrThrow({ where: { id: variantId } });
}
