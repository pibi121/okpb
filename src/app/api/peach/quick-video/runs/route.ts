import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { listQuickVideoRuns, startQuickVideoRun } from "@/lib/quick-video";
import {
  MAX_QUICK_VIDEO_PICTURES,
  type QuickVideoShotsPlan,
  type QuickVideoSlotRole,
} from "@/lib/quick-video-prompt";
import { videoOrientationSchema } from "@/lib/video-orientation";

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

const jsonSchema = z.object({
  title: z.string().max(120).optional(),
  prompt: z.string().min(8).max(8000),
  characterIds: z.array(z.string()).max(4).optional(),
  orientation: videoOrientationSchema.optional(),
  durationSec: z.number().min(4).max(12).optional(),
  extraRefImageUrls: z.array(z.string().min(1)).max(9).optional(),
  extraRefLabels: z.array(z.string().max(120)).optional(),
  poseVideoUrl: z.string().min(1).optional(),
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

function parseShotsPlan(raw: FormDataEntryValue | null): QuickVideoShotsPlan | null {
  if (!raw) return null;
  try {
    const j = JSON.parse(String(raw)) as QuickVideoShotsPlan;
    if (!Array.isArray(j.shots)) return null;
    return j;
  } catch {
    return null;
  }
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
          pictureIndex: Math.min(MAX_QUICK_VIDEO_PICTURES, Math.floor(pictureIndex)),
          role,
          label: typeof row?.label === "string" ? row.label.slice(0, 120) : undefined,
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

function parseCustomCharacters(raw: FormDataEntryValue | null) {
  if (!raw) return [];
  try {
    const j = JSON.parse(String(raw));
    if (!Array.isArray(j)) return [];
    return j
      .map((row) => ({
        id: typeof row?.id === "string" ? row.id : "",
        name: typeof row?.name === "string" ? row.name.slice(0, 40) : "",
      }))
      .filter((c) => c.id.startsWith("custom:") && c.name.length >= 2);
  } catch {
    return [];
  }
}

export async function GET() {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });
  const runs = await listQuickVideoRuns(user.id);
  return NextResponse.json({ runs, maxPictures: MAX_QUICK_VIDEO_PICTURES });
}

export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });

  const ctype = req.headers.get("content-type") || "";
  try {
    if (ctype.includes("multipart/form-data")) {
      const form = await req.formData();
      const title = String(form.get("title") || "");
      const prompt = String(form.get("prompt") || "");
      const shotsPlan = parseShotsPlan(form.get("shotsJson"));
      const orientation = String(form.get("orientation") || "9_16");
      const durationSec = Number(form.get("durationSec") || 6);
      const characterIds = parseIds(form.get("characterIds"));
      const customCharacters = parseCustomCharacters(form.get("customCharacters"));
      const slotMeta = parseSlotMeta(form.get("slotMeta"));

      const manualSlots: Array<{
        pictureIndex: number;
        role: QuickVideoSlotRole;
        label?: string;
        characterName?: string;
        bytes: Buffer;
        ext?: string;
      }> = [];

      for (let i = 1; i <= MAX_QUICK_VIDEO_PICTURES; i++) {
        const file = form.get(`picture_${i}`);
        if (!(file instanceof File) || file.size <= 0) continue;
        const meta =
          slotMeta.find((m) => m.pictureIndex === i) ||
          ({ pictureIndex: i, role: "other" as QuickVideoSlotRole });
        manualSlots.push({
          pictureIndex: i,
          role: meta.role,
          label: meta.label,
          characterName: meta.characterName,
          bytes: Buffer.from(await file.arrayBuffer()),
          ext: extFromName(file.name || "ref.png"),
        });
      }

      // Legacy fallback: extraPhotos blob list
      if (!manualSlots.length) {
        const extraLabels = parseIds(form.get("extraLabels"));
        const extraFiles = form
          .getAll("extraPhotos")
          .filter((f) => f instanceof File) as File[];
        const legacyPhotos = form
          .getAll("photos")
          .filter((f) => f instanceof File) as File[];
        const extraBuffers: Buffer[] = [];
        const extraExts: string[] = [];
        for (const f of [...extraFiles, ...legacyPhotos].slice(0, 9)) {
          extraBuffers.push(Buffer.from(await f.arrayBuffer()));
          extraExts.push(extFromName(f.name || "ref.png"));
        }

        let poseVideoBuffer: Buffer | null = null;
        let poseVideoName = "pose.mp4";
        const poseFile = form.get("poseVideo");
        if (poseFile instanceof File && poseFile.size > 0) {
          poseVideoBuffer = Buffer.from(await poseFile.arrayBuffer());
          poseVideoName = poseFile.name || poseVideoName;
        }

        const run = await startQuickVideoRun({
          userId: user.id,
          title,
          prompt: shotsPlan ? undefined : prompt,
          shotsPlan: shotsPlan || undefined,
          characterIds,
          extraImageBuffers: extraBuffers,
          extraExtensions: extraExts,
          extraLabels,
          poseVideoBuffer,
          poseVideoName,
          orientation,
          durationSec,
          customCharacters,
        });
        return NextResponse.json({ run });
      }

      let poseVideoBuffer: Buffer | null = null;
      let poseVideoName = "pose.mp4";
      const poseFile = form.get("poseVideo");
      if (poseFile instanceof File && poseFile.size > 0) {
        poseVideoBuffer = Buffer.from(await poseFile.arrayBuffer());
        poseVideoName = poseFile.name || poseVideoName;
      }

      const run = await startQuickVideoRun({
        userId: user.id,
        title,
        prompt: shotsPlan ? undefined : prompt,
        shotsPlan: shotsPlan || undefined,
        characterIds,
        manualSlots,
        poseVideoBuffer,
        poseVideoName,
        orientation,
        durationSec,
        customCharacters,
      });
      return NextResponse.json({ run });
    }

    const body = jsonSchema.parse(await req.json());
    const { localBytesFromResultUrl } = await import("@/lib/peach-lab");
    const extraBuffers: Buffer[] = [];
    for (const url of body.extraRefImageUrls || []) {
      const b = localBytesFromResultUrl(url);
      if (!b?.length) throw new Error(`Не найден файл: ${url}`);
      extraBuffers.push(b);
    }

    let poseVideoBuffer: Buffer | null = null;
    if (body.poseVideoUrl) {
      poseVideoBuffer = localBytesFromResultUrl(body.poseVideoUrl);
      if (!poseVideoBuffer?.length) {
        throw new Error(`Не найден pose video: ${body.poseVideoUrl}`);
      }
    }

    const run = await startQuickVideoRun({
      userId: user.id,
      title: body.title,
      prompt: body.prompt,
      characterIds: body.characterIds,
      extraImageBuffers: extraBuffers,
      extraLabels: body.extraRefLabels,
      poseVideoBuffer,
      orientation: body.orientation,
      durationSec: body.durationSec,
    });
    return NextResponse.json({ run });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
