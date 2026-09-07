/**
 * One-shot / boot migration: scrub author identity out of stored templates.
 */
import { prisma } from "@/lib/db";
import { sanitizeTemplateScenePrompt } from "@/lib/template-scene";
import {
  parseQuickVideoShotsPlan,
  serializeQuickVideoShotsPlan,
} from "@/lib/quick-video-prompt";
import { sanitizeVideoLegoQuery } from "@/lib/template-scene";

let ran = false;

export async function migrateTemplateIdentityHygiene(): Promise<{
  photos: number;
  videos: number;
}> {
  if (ran) return { photos: 0, videos: 0 };
  ran = true;

  let photos = 0;
  let videos = 0;

  const photoRows = await prisma.photoTemplate.findMany({
    select: { id: true, editPrompt: true, title: true },
  });
  for (const row of photoRows) {
    const next = sanitizeTemplateScenePrompt(row.editPrompt || "", {
      fallback: row.title || "cinematic photo scene",
    });
    if (next !== (row.editPrompt || "").trim()) {
      await prisma.photoTemplate.update({
        where: { id: row.id },
        data: { editPrompt: next },
      });
      photos += 1;
    }
  }

  const videoRows = await prisma.quickVideoTemplate.findMany({
    select: {
      id: true,
      userId: true,
      shotsJson: true,
      slotBlueprintJson: true,
    },
  });
  for (const row of videoRows) {
    const authorChars = await prisma.character.findMany({
      where: { userId: row.userId },
      select: { name: true },
    });
    let labels: string[] = [];
    try {
      const bp = JSON.parse(row.slotBlueprintJson || "[]") as Array<{
        role?: string;
        label?: string;
      }>;
      labels = bp
        .filter((b) => b.role === "identity")
        .map((b) => (b.label || "").trim())
        .filter(Boolean);
    } catch {
      labels = [];
    }
    const names = [
      ...authorChars.map((c) => c.name.trim()).filter(Boolean),
      ...labels.filter((n) => n !== "Subject"),
    ];
    const plan = parseQuickVideoShotsPlan(row.shotsJson);
    if (!plan) continue;
    let changed = false;
    const shots = plan.shots.map((s) => {
      const q = sanitizeVideoLegoQuery(s.legoQuery, names);
      if (q !== s.legoQuery) changed = true;
      return { ...s, legoQuery: q };
    });
    let bpChanged = false;
    let nextBp = row.slotBlueprintJson;
    try {
      const bp = JSON.parse(row.slotBlueprintJson || "[]") as Array<Record<string, unknown>>;
      const scrubbed = bp.map((b) => {
        if (b.role === "identity") {
          if (b.label && b.label !== "Subject") bpChanged = true;
          return { ...b, label: "Subject", bakedRefUrl: undefined };
        }
        return b;
      });
      if (bpChanged) nextBp = JSON.stringify(scrubbed);
    } catch {
      /* keep */
    }
    if (changed || bpChanged) {
      await prisma.quickVideoTemplate.update({
        where: { id: row.id },
        data: {
          shotsJson: changed
            ? serializeQuickVideoShotsPlan({ ...plan, shots })
            : row.shotsJson,
          slotBlueprintJson: nextBp,
        },
      });
      videos += 1;
    }
  }

  console.log(
    `[peach] template identity hygiene: photos=${photos} videos=${videos}`,
  );
  return { photos, videos };
}
