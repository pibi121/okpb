import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { startQuickVideoRun } from "@/lib/quick-video";
import {
  MAX_QUICK_VIDEO_PICTURES,
  type QuickVideoSlotRole,
} from "@/lib/quick-video-prompt";
import { videoOrientationSchema } from "@/lib/video-orientation";
import { storyH3LooksStructured } from "@/lib/story-h3-prompt";
import {
  createCustomCharacterId,
  isValidCustomCharacterName,
  normalizeCustomCharacterName,
} from "@/lib/quick-video-custom-character";
import {
  VIDEO_BODY_LOOKBOOK_FIELD_IDS,
  bodyShapeAppearanceForPrompt,
  emptyLookbook,
  parseLookbook,
} from "@/lib/lookbook";

export const runtime = "nodejs";
export const maxDuration = 900;

const ROLES = new Set<QuickVideoSlotRole>([
  "identity",
  "location",
  "pose",
  "object",
  "anatomy",
  "other",
]);

function extFromName(name: string) {
  const m = /\.([a-z0-9]+)$/i.exec(name);
  return m ? m[1].toLowerCase() : "png";
}

function parseSlotMeta(raw: FormDataEntryValue | null): Array<{
  pictureIndex: number;
  role: QuickVideoSlotRole;
  label?: string;
}> {
  if (!raw) return [];
  try {
    const j = JSON.parse(String(raw));
    if (!Array.isArray(j)) return [];
    return j
      .map((row) => {
        const pictureIndex = Number(row?.pictureIndex);
        const roleRaw = String(row?.role || "other") as QuickVideoSlotRole;
        const role = ROLES.has(roleRaw) ? roleRaw : "other";
        if (!Number.isFinite(pictureIndex) || pictureIndex < 1) return null;
        return {
          pictureIndex: Math.min(
            MAX_QUICK_VIDEO_PICTURES,
            Math.floor(pictureIndex),
          ),
          role,
          label:
            typeof row?.label === "string" ? row.label.slice(0, 120) : undefined,
        };
      })
      .filter(Boolean) as Array<{
      pictureIndex: number;
      role: QuickVideoSlotRole;
      label?: string;
    }>;
  } catch {
    return [];
  }
}

function parseBodyLookbook(raw: FormDataEntryValue | null) {
  if (!raw) return emptyLookbook("female");
  try {
    const j = JSON.parse(String(raw)) as Record<string, string>;
    const base = emptyLookbook("female");
    const ids = VIDEO_BODY_LOOKBOOK_FIELD_IDS.female;
    for (const [k, v] of Object.entries(j)) {
      if (ids.has(k) && typeof v === "string") base[k] = v;
    }
    return parseLookbook(JSON.stringify(base), "female");
  } catch {
    return emptyLookbook("female");
  }
}

export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });

  try {
    const form = await req.formData();
    const title = String(form.get("title") || "").slice(0, 120);
    const prompt = String(form.get("prompt") || "").trim();
    if (prompt.length < 80) {
      return NextResponse.json(
        { error: "Вставь полный H3-промпт от Grok (слишком короткий)" },
        { status: 400 },
      );
    }
    if (prompt.length > 24000) {
      return NextResponse.json(
        { error: "Промпт слишком длинный (макс ~24k символов)" },
        { status: 400 },
      );
    }

    const modelName = normalizeCustomCharacterName(
      String(form.get("modelName") || ""),
    );
    if (!isValidCustomCharacterName(modelName)) {
      return NextResponse.json(
        { error: "Имя модели — минимум 2 символа" },
        { status: 400 },
      );
    }

    const orientationRaw = String(form.get("orientation") || "9_16");
    const orientationParsed = videoOrientationSchema.safeParse(orientationRaw);
    const orientation = orientationParsed.success
      ? orientationParsed.data
      : "9_16";
    const durationSec = Math.min(
      12,
      Math.max(4, Number(form.get("durationSec") || 8)),
    );
    const slotMeta = parseSlotMeta(form.get("slotMeta"));
    const bodyLookbook = parseBodyLookbook(form.get("bodyLookbook"));
    const bodyHint = bodyShapeAppearanceForPrompt(bodyLookbook, "female");

    const manualSlots: Array<{
      pictureIndex: number;
      role: QuickVideoSlotRole;
      label?: string;
      characterName?: string;
      bodyShapeHint?: string;
      bytes: Buffer;
      ext?: string;
    }> = [];

    for (let i = 1; i <= MAX_QUICK_VIDEO_PICTURES; i++) {
      const file = form.get(`picture_${i}`);
      if (!(file instanceof File) || file.size <= 0) continue;
      const meta =
        slotMeta.find((m) => m.pictureIndex === i) ||
        ({
          pictureIndex: i,
          role: (i <= 3
            ? "identity"
            : i === 4
              ? "location"
              : "other") as QuickVideoSlotRole,
        });
      manualSlots.push({
        pictureIndex: i,
        role: meta.role,
        label: meta.label,
        characterName: meta.role === "identity" ? modelName : undefined,
        bodyShapeHint: meta.role === "identity" ? bodyHint || undefined : undefined,
        bytes: Buffer.from(await file.arrayBuffer()),
        ext: extFromName(file.name || "ref.png"),
      });
    }

    if (!manualSlots.some((s) => s.role === "identity")) {
      return NextResponse.json(
        { error: "Загрузи хотя бы одно identity-фото (Picture 1–3)" },
        { status: 400 },
      );
    }

    const poseFile = form.get("poseVideo");
    let poseVideoBuffer: Buffer | null = null;
    let poseVideoName: string | undefined;
    if (poseFile instanceof File && poseFile.size > 0) {
      poseVideoBuffer = Buffer.from(await poseFile.arrayBuffer());
      poseVideoName = poseFile.name || "pose.mp4";
    }

    const customId = createCustomCharacterId();
    const bodyIds = [...VIDEO_BODY_LOOKBOOK_FIELD_IDS.female];
    const bodyPayload: Record<string, string> = {};
    for (const id of bodyIds) {
      if (bodyLookbook[id]) bodyPayload[id] = bodyLookbook[id]!;
    }

    const run = await startQuickVideoRun({
      userId: user.id,
      title: title || `Story H3 · ${modelName}`,
      prompt,
      storyH3: true,
      storyModelName: modelName,
      bodyLookbook: bodyPayload,
      characterIds: [customId],
      customCharacters: [{ id: customId, name: modelName }],
      manualSlots,
      poseVideoBuffer,
      poseVideoName,
      orientation,
      durationSec,
    });

    return NextResponse.json({
      ok: true,
      run,
      bodyHint: bodyHint || null,
      structured: storyH3LooksStructured(prompt),
      warning: storyH3LooksStructured(prompt)
        ? undefined
        : "Промпт не похож на 6 секций H3 — лучше вставить полный вывод Grok.",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
