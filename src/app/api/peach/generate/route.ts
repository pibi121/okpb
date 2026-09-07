import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import {
  enqueueAnimateJob,
  enqueueClipJob,
  enqueueEditJob,
  enqueueFilmJob,
  enqueuePhotoJob,
  enqueueRegenJob,
} from "@/lib/gallery-jobs";
import {
  MAX_QUICK_VIDEO_PICTURES,
  type QuickVideoSlotRole,
} from "@/lib/quick-video-prompt";
import type { PhotoManualSlot } from "@/lib/photo-refs-shared";

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

const photoSchema = z.object({
  action: z.literal("photo"),
  characterId: z.string().optional().nullable(),
  characterIds: z.array(z.string()).optional(),
  poseId: z.string().optional(),
  styleId: z.string().optional(),
  userNote: z.string().optional(),
  includeMale: z.boolean().optional(),
  clothed: z.boolean().optional(),
  pokies: z.boolean().optional(),
  usePreset: z.boolean().optional(),
  presetId: z.string().optional().nullable(),
  width: z.number().int().optional(),
  height: z.number().int().optional(),
  title: z.string().optional(),
  composedPrompt: z.string().optional(),
  skinDetail: z.boolean().optional(),
  skinDetailStrength: z.number().min(0).max(3.5).optional(),
  legoQuery: z.string().optional(),
  orientationId: z.string().optional(),
  photoCount: z.number().int().min(1).max(4).optional(),
  photoTemplateId: z.string().optional(),
  useIdentityDualRef: z.boolean().optional(),
});

const editSchema = z.object({
  action: z.literal("edit"),
  itemId: z.string(),
  editPrompt: z.string().min(2),
});

const regenSchema = z.object({
  action: z.literal("regen"),
  itemId: z.string(),
});

const clipSchema = z.object({
  action: z.literal("clip"),
  characterId: z.string().optional().nullable(),
  plot: z.string().min(2),
  stillId: z.string().optional(),
  withMusic: z.boolean().optional(),
  durationSec: z.number().int().min(4).max(12).optional(),
  title: z.string().optional(),
  composedPrompt: z.string().optional(),
});

const filmSchema = z.object({
  action: z.literal("film"),
  characterId: z.string().optional().nullable(),
  plot: z.string().min(2),
  sceneCount: z.number().int().min(2).max(4).optional(),
  withMusic: z.boolean().optional(),
  durationSec: z.number().int().min(4).max(12).optional(),
  title: z.string().optional(),
});

const animateSchema = z.object({
  action: z.literal("animate"),
  itemId: z.string(),
  plot: z.string().optional(),
  withMusic: z.boolean().optional(),
  durationSec: z.number().int().min(4).max(12).optional(),
  composedPrompt: z.string().optional(),
});

function extFromName(name: string) {
  const m = /\.([a-z0-9]+)$/i.exec(name);
  return m ? m[1].toLowerCase() : "png";
}

function parseIds(raw: FormDataEntryValue | string | null): string[] {
  if (!raw) return [];
  const text = typeof raw === "string" ? raw : String(raw);
  if (!text.trim()) return [];
  try {
    const j = JSON.parse(text);
    if (Array.isArray(j)) return j.filter((x) => typeof x === "string");
  } catch {
    /* fall through */
  }
  return text
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseSlotMeta(raw: FormDataEntryValue | null): Array<{
  pictureIndex: number;
  role: QuickVideoSlotRole;
  label?: string;
  characterName?: string;
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
          characterName:
            typeof row?.characterName === "string"
              ? row.characterName.slice(0, 80)
              : undefined,
        };
      })
      .filter(Boolean) as Array<{
      pictureIndex: number;
      role: QuickVideoSlotRole;
      label?: string;
      characterName?: string;
    }>;
  } catch {
    return [];
  }
}

async function handlePhotoMultipart(userId: string, form: FormData) {
  const characterIds = parseIds(form.get("characterIds"));
  const slotMeta = parseSlotMeta(form.get("slotMeta"));
  const photoTemplateId = String(form.get("photoTemplateId") || "").trim();
  const useIdentityDualRef = String(form.get("useIdentityDualRef") || "") === "1";
  const legoQuery = String(form.get("legoQuery") || "");
  const orientationId = String(form.get("orientationId") || "");
  const width = Number(form.get("width") || 0);
  const height = Number(form.get("height") || 0);
  const title = String(form.get("title") || "");
  const poseId = String(form.get("poseId") || "");
  const styleId = String(form.get("styleId") || "");
  const skinDetail = String(form.get("skinDetail") || "") === "1";
  const skinDetailStrength = Number(form.get("skinDetailStrength") || 1.2);

  const manualSlots: PhotoManualSlot[] = [];
  const customIdentityBuffers: Buffer[] = [];

  for (let i = 1; i <= MAX_QUICK_VIDEO_PICTURES; i++) {
    const file = form.get(`picture_${i}`);
    if (!(file instanceof File) || file.size <= 0) continue;
    const meta =
      slotMeta.find((m) => m.pictureIndex === i) ||
      ({ pictureIndex: i, role: "other" as QuickVideoSlotRole });
    const bytes = Buffer.from(await file.arrayBuffer());
    if (meta.role === "identity" && meta.characterName?.startsWith("custom:")) {
      customIdentityBuffers.push(bytes);
    }
    manualSlots.push({
      pictureIndex: i,
      role: meta.role,
      label: meta.label,
      characterName: meta.characterName,
      bytes,
      ext: extFromName(file.name || "ref.png"),
    });
  }

  const customPhotos = form
    .getAll("customIdentityPhotos")
    .filter((f) => f instanceof File) as File[];
  for (const f of customPhotos.slice(0, 5)) {
    customIdentityBuffers.push(Buffer.from(await f.arrayBuffer()));
  }

  return enqueuePhotoJob(userId, {
    userId,
    characterIds,
    characterId: characterIds[0] || null,
    legoQuery,
    orientationId: orientationId || undefined,
    width: width > 0 ? width : undefined,
    height: height > 0 ? height : undefined,
    title: title || undefined,
    poseId: poseId || undefined,
    styleId: styleId || undefined,
    skinDetail,
    skinDetailStrength,
    photoTemplateId: photoTemplateId || undefined,
    useIdentityDualRef,
    manualSlots,
    customIdentityBuffers: customIdentityBuffers.length
      ? customIdentityBuffers
      : undefined,
  });
}

export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });

  const ctype = req.headers.get("content-type") || "";

  try {
    if (ctype.includes("multipart/form-data")) {
      const form = await req.formData();
      const action = String(form.get("action") || "");
      if (action === "photo") {
        const item = await handlePhotoMultipart(user.id, form);
        return NextResponse.json({ item });
      }
      return NextResponse.json({ error: "unknown action" }, { status: 400 });
    }

    const body = await req.json();
    const action = body?.action as string;

    if (action === "photo") {
      const data = photoSchema.parse(body);
      const count = data.photoCount ?? 1;
      let lastItem = null;
      for (let i = 0; i < count; i++) {
        lastItem = await enqueuePhotoJob(user.id, {
          userId: user.id,
          ...data,
          title: data.title || (count > 1 ? `Фото ${i + 1}/${count}` : undefined),
          legoQuery: data.legoQuery,
          orientationId: data.orientationId,
          useIdentityDualRef: data.useIdentityDualRef,
        });
      }
      return NextResponse.json({ item: lastItem });
    }
    if (action === "edit") {
      const data = editSchema.parse(body);
      const item = await enqueueEditJob(user.id, data.itemId, data.editPrompt);
      return NextResponse.json({ item });
    }
    if (action === "regen") {
      const data = regenSchema.parse(body);
      const item = await enqueueRegenJob(user.id, data.itemId);
      return NextResponse.json({ item });
    }
    if (action === "clip") {
      const data = clipSchema.parse(body);
      const item = await enqueueClipJob(user.id, { userId: user.id, ...data });
      return NextResponse.json({ item });
    }
    if (action === "film") {
      const data = filmSchema.parse(body);
      const item = await enqueueFilmJob(user.id, { userId: user.id, ...data });
      return NextResponse.json({ item });
    }
    if (action === "animate") {
      const data = animateSchema.parse(body);
      const item = await enqueueAnimateJob(
        user.id,
        data.itemId,
        data.plot?.trim() || "match the still pose",
        data.withMusic,
        data.composedPrompt?.trim() || undefined,
        data.durationSec,
      );
      return NextResponse.json({ item });
    }
    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
