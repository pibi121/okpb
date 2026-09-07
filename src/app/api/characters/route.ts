import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { emptyLookbook, suggestedLookbook, type Gender } from "@/lib/lookbook";

const createSchema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(500).optional(),
  consentGiven: z.literal(true),
  gender: z.enum(["female", "male"]).default("female"),
  photoCount: z.number().int().min(0).max(50).default(20),
  triggerWord: z.string().max(64).optional(),
  loraStatus: z
    .enum(["lookbook", "lookbook_ready", "lora_training", "lora_ready"])
    .optional(),
  lookbook: z.record(z.string(), z.string()).optional(),
});

const patchSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(80).optional(),
  description: z.string().max(500).optional().nullable(),
  gender: z.enum(["female", "male"]).optional(),
  triggerWord: z.string().max(64).optional().nullable(),
  loraStatus: z
    .enum(["lookbook", "lookbook_ready", "lora_training", "lora_ready"])
    .optional(),
  lookbook: z.record(z.string(), z.string()).optional(),
  photoCount: z.number().int().min(0).max(50).optional(),
});

export async function GET() {
  const user = await requireUser();
  if (!user) {
    return NextResponse.json({ error: "Нужен вход" }, { status: 401 });
  }

  const characters = await prisma.character.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ characters });
}

export async function POST(req: Request) {
  const user = await requireUser();
  if (!user) {
    return NextResponse.json({ error: "Нужен вход" }, { status: 401 });
  }

  const url = new URL(req.url);
  if (url.searchParams.get("action") === "seed_olh") {
    const existing = await prisma.character.findFirst({
      where: { userId: user.id, triggerWord: "olh_person" },
    });
    if (existing) {
      return NextResponse.json({
        character: existing,
        message: "olh_person уже есть в списке",
      });
    }
    const character = await prisma.character.create({
      data: {
        userId: user.id,
        name: "olh_person",
        gender: "female",
        consentGiven: true,
        photoCount: 25,
        status: "ready",
        loraStatus: "lora_ready",
        triggerWord: "olh_person",
        loraPath: "krea2/olh_person_krea2.safetensors",
        lookbookJson: JSON.stringify(suggestedLookbook("female", "olh")),
      },
    });
    return NextResponse.json({
      character,
      message: "Добавлена LoRA olh_person (Krea) + Lookbook",
    });
  }

  const body = await req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Укажите имя и согласие на использование лица" },
      { status: 400 },
    );
  }

  const gender = parsed.data.gender as Gender;
  const lookbook = {
    ...emptyLookbook(gender),
    ...(parsed.data.lookbook || {}),
  };
  const loraStatus = parsed.data.loraStatus || "lookbook_ready";

  const character = await prisma.character.create({
    data: {
      userId: user.id,
      name: parsed.data.name,
      description: parsed.data.description,
      gender,
      consentGiven: true,
      photoCount: parsed.data.photoCount,
      status: "ready",
      loraStatus,
      triggerWord: parsed.data.triggerWord || null,
      lookbookJson: JSON.stringify(lookbook),
      loraPath:
        loraStatus === "lora_ready"
          ? parsed.data.triggerWord === "olh_person"
            ? "krea2/olh_person_krea2.safetensors"
            : `mock://lora/${parsed.data.name}`
          : null,
    },
  });

  return NextResponse.json({ character });
}

export async function PATCH(req: Request) {
  const user = await requireUser();
  if (!user) {
    return NextResponse.json({ error: "Нужен вход" }, { status: 401 });
  }

  const parsed = patchSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "bad payload" }, { status: 400 });
  }

  const existing = await prisma.character.findFirst({
    where: { id: parsed.data.id, userId: user.id },
  });
  if (!existing) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const gender = (parsed.data.gender || existing.gender || "female") as Gender;

  const character = await prisma.character.update({
    where: { id: existing.id },
    data: {
      name: parsed.data.name,
      description:
        parsed.data.description === undefined ? undefined : parsed.data.description,
      gender: parsed.data.gender,
      triggerWord:
        parsed.data.triggerWord === undefined ? undefined : parsed.data.triggerWord,
      loraStatus: parsed.data.loraStatus,
      photoCount: parsed.data.photoCount,
      lookbookJson: parsed.data.lookbook
        ? JSON.stringify({ ...emptyLookbook(gender), ...parsed.data.lookbook })
        : undefined,
      loraPath:
        parsed.data.loraStatus === "lora_ready"
          ? existing.loraPath ||
            (existing.triggerWord === "olh_person"
              ? "krea2/olh_person_krea2.safetensors"
              : `mock://lora/${existing.name}`)
          : parsed.data.loraStatus
            ? null
            : undefined,
    },
  });

  return NextResponse.json({ character });
}
