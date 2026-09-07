import type { TemplateCategory } from "@/lib/quick-video-template-shared";
import type { TemplateSlotBlueprint } from "@/lib/quick-video-template-shared";

export type PublicPeachPhotoTemplate = {
  id: string;
  title: string;
  notes: string;
  category: TemplateCategory;
  isJuice: boolean;
  priceCredits: number;
  previewImageUrl: string;
  sceneImageUrl: string;
  orientation: string;
  identityPersonCount: number;
  hasLocationSlot: boolean;
  owned: boolean;
  isAuthor: boolean;
};

export type PeachPhotoTemplateDetail = PublicPeachPhotoTemplate & {
  legoQuery: string;
  poseId: string;
  styleId: string;
  skinDetail: boolean;
  skinDetailStrength: number;
  slotBlueprint: TemplateSlotBlueprint[];
  defaultLocationUrl: string;
};

export type PeachPhotoTemplateApplyPayload = {
  templateId: string;
  title: string;
  legoQuery: string;
  orientation: string;
  poseId: string;
  styleId: string;
  skinDetail: boolean;
  skinDetailStrength: number;
  slotBlueprint: TemplateSlotBlueprint[];
  defaultLocationUrl: string;
  sceneImageUrl: string;
  identityPersonCount: number;
  hasLocationSlot: boolean;
};

export function buildPhotoTemplateApplyPayload(
  detail: PeachPhotoTemplateDetail,
): PeachPhotoTemplateApplyPayload {
  return {
    templateId: detail.id,
    title: detail.title,
    legoQuery: detail.legoQuery,
    orientation: detail.orientation,
    poseId: detail.poseId,
    styleId: detail.styleId,
    skinDetail: detail.skinDetail,
    skinDetailStrength: detail.skinDetailStrength,
    slotBlueprint: detail.slotBlueprint,
    defaultLocationUrl: detail.defaultLocationUrl,
    sceneImageUrl: detail.sceneImageUrl || detail.previewImageUrl,
    identityPersonCount: detail.identityPersonCount,
    hasLocationSlot: detail.hasLocationSlot,
  };
}
