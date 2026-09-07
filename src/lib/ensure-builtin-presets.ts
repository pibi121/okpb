import { prisma } from "@/lib/db";
import { loadPromptTemplates } from "@/lib/prompt-templates";

export async function ensureBuiltinPresets() {
  const count = await prisma.peachPreset.count({ where: { isBuiltin: true } });
  if (count > 0) return;

  const templates = loadPromptTemplates();
  const styleId = templates.styles[0] ? templates.styles[0].id : "warm_lamp_bedroom";

  for (const pose of templates.poses.slice(0, 8)) {
    const payload = {
      poseId: pose.id,
      styleId,
      includeMale: true,
      width: 888,
      height: 1176,
    };
    await prisma.peachPreset.create({
      data: {
        slug: "builtin_photo_" + pose.id,
        title: "Photo - " + pose.label,
        kind: "photo",
        isBuiltin: true,
        payloadJson: JSON.stringify(payload),
        notes: "Seed from prompt_presets.json",
      },
    });
  }
}
