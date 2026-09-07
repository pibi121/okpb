/**
 * Ready-made text snippets for Krea photo edit / TG dual-ref prompts.
 * Sources: presets/prompt_presets.json (poses) + presets/prompt_lego.json.
 */
import { loadLegoFile } from "@/lib/prompt-lego";
import { loadPromptTemplates } from "@/lib/prompt-templates";

export type PhotoEditPromptPreset = {
  id: string;
  label: string;
  text: string;
  category: "pose" | "lighting" | "event" | "stylization" | "body";
};

export type PhotoEditPromptPresetGroups = {
  poses: PhotoEditPromptPreset[];
  lighting: PhotoEditPromptPreset[];
  events: PhotoEditPromptPreset[];
  stylization: PhotoEditPromptPreset[];
  body: PhotoEditPromptPreset[];
};

export function loadPhotoEditPromptPresets(): PhotoEditPromptPresetGroups {
  const templates = loadPromptTemplates();
  const lego = loadLegoFile();

  const poses: PhotoEditPromptPreset[] = templates.poses.map((p) => ({
    id: p.id,
    label: p.label,
    text: p.text,
    category: "pose",
  }));

  const lighting: PhotoEditPromptPreset[] = lego.lighting.map((x) => ({
    id: x.id,
    label: x.label,
    text: x.text || x.label,
    category: "lighting",
  }));

  const events: PhotoEditPromptPreset[] = lego.events.map((x) => ({
    id: x.id,
    label: x.label,
    text: x.text || x.label,
    category: "event",
  }));

  const stylization: PhotoEditPromptPreset[] = lego.stylization.map((x) => ({
    id: x.id,
    label: x.label,
    text: x.text || x.label,
    category: "stylization",
  }));

  const body: PhotoEditPromptPreset[] = (lego.body || []).map((x) => ({
    id: x.id,
    label: x.label,
    text: x.text || x.label,
    category: "body",
  }));

  return { poses, lighting, events, stylization, body };
}

export function flattenPhotoEditPromptPresets(
  groups: PhotoEditPromptPresetGroups,
): PhotoEditPromptPreset[] {
  return [
    ...groups.poses,
    ...groups.lighting,
    ...groups.events,
    ...groups.stylization,
    ...groups.body,
  ];
}
