import type { QuickVideoSlotRole } from "@/lib/quick-video-prompt";

export type TemplateCategory = "peach" | "bitch";

export type TemplateSlotBlueprint = {
  role: QuickVideoSlotRole;
  label?: string;
  /** Baked into template (location default, anatomy, pose, …). */
  bakedRefUrl?: string;
  /** Original 1-based Picture index from the source run (Story H3 / Ref2V). */
  pictureIndex?: number;
};

export type PublicQuickVideoTemplate = {
  id: string;
  title: string;
  notes: string;
  category: TemplateCategory;
  isJuice: boolean;
  priceCredits: number;
  identityPersonCount: number;
  hasLocationSlot: boolean;
  previewVideoUrl: string;
  previewPhotoUrl: string;
  orientation: string;
  durationSec: number;
  owned: boolean;
  isAuthor: boolean;
};

export type QuickVideoTemplateDetail = PublicQuickVideoTemplate & {
  shotsJson: string;
  slotBlueprint: TemplateSlotBlueprint[];
  defaultLocationUrl: string;
  refVideoUrl: string;
};

export type QuickVideoTemplateApplyPayload = {
  templateId: string;
  title: string;
  shotsJson: string;
  orientation: string;
  durationSec: number;
  slotBlueprint: TemplateSlotBlueprint[];
  defaultLocationUrl: string;
  refVideoUrl: string;
  identityPersonCount: number;
  hasLocationSlot: boolean;
};

export function userOwnsTemplate(opts: {
  isAuthor: boolean;
  isJuice: boolean;
  priceCredits: number;
  purchased: boolean;
}): boolean {
  if (opts.isAuthor) return true;
  if (!opts.isJuice || opts.priceCredits <= 0) return true;
  return opts.purchased;
}

export function buildTemplateApplyPayload(
  detail: QuickVideoTemplateDetail,
): QuickVideoTemplateApplyPayload {
  return {
    templateId: detail.id,
    title: detail.title,
    shotsJson: detail.shotsJson,
    orientation: detail.orientation,
    durationSec: detail.durationSec,
    slotBlueprint: detail.slotBlueprint,
    defaultLocationUrl: detail.defaultLocationUrl,
    refVideoUrl: detail.refVideoUrl,
    identityPersonCount: detail.identityPersonCount,
    hasLocationSlot: detail.hasLocationSlot,
  };
}

export function parseBlueprint(raw: string): TemplateSlotBlueprint[] {
  try {
    const j = JSON.parse(raw);
    if (!Array.isArray(j)) return [];
    return j.filter((row) => row && typeof row.role === "string");
  } catch {
    return [];
  }
}
