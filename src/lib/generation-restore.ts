import type { QuickVideoImageSlot } from "@/lib/quick-video-prompt";
import type { PeachPhotoTemplateApplyPayload } from "@/lib/peach-photo-template-shared";
import type { QuickVideoTemplateApplyPayload } from "@/lib/quick-video-template-shared";

const PHOTO_KEY = "peach-restore-photo";
const STORY_VIDEO_KEY = "peach-restore-story-video";

export const PEACH_VIDEO_RESTORE_EVENT = "peach-video-restore";
export const PEACH_STORY_VIDEO_RESTORE_EVENT = "peach-story-video-restore";
export const PEACH_VIDEO_TEMPLATE_APPLY_EVENT = "peach-video-template-apply";
export const PEACH_PHOTO_TEMPLATE_APPLY_EVENT = "peach-photo-template-apply";

export type QuickVideoTemplateUsePayload = QuickVideoTemplateApplyPayload & {
  identityMode: "character" | "custom";
  characterIds?: string[];
  customName?: string;
  identityFiles?: File[];
  locationFile?: File | null;
};

export type PeachPhotoTemplateUsePayload = PeachPhotoTemplateApplyPayload & {
  identityMode: "character" | "custom";
  characterIds?: string[];
  customName?: string;
  identityFiles?: File[];
  locationFile?: File | null;
};

export type PhotoRestorePayload = {
  legoQuery: string;
  characterIds: string[];
  orientationId: string;
  poseId?: string;
  styleId?: string;
  skinDetail?: boolean;
  skinDetailStrength?: number;
};

export type VideoRestorePayload = {
  runId?: string;
  title?: string;
  /** Legacy plain prompt or serialized shots plan JSON */
  prompt?: string;
  shotsJson?: string;
  characterIds?: string[];
  customCharacters?: Array<{ id: string; name: string }>;
  orientation?: string;
  durationSec?: number;
  refImageUrls?: string[];
  refVideoUrl?: string;
  refSlots?: QuickVideoImageSlot[];
};

export type StoryVideoRestorePayload = {
  runId?: string;
  title?: string;
  prompt?: string;
  characterIds?: string[];
  orientation?: string;
  durationSec?: number;
  refImageUrls?: string[];
  refVideoUrl?: string;
  refSlots?: QuickVideoImageSlot[];
  storyModelName?: string;
  bodyLookbook?: Record<string, string>;
};

export function isStoryH3Meta(
  meta?: Record<string, unknown> | null,
  promptHint?: string | null,
): boolean {
  if (meta?.storyH3 === true) return true;
  if (meta?.jobAction === "story_h3_video") return true;
  const shots =
    typeof meta?.shotsJson === "string" ? meta.shotsJson : undefined;
  const candidate = shots || promptHint || "";
  if (!candidate.trim()) return false;
  if (candidate.trim().startsWith('{"__qvShots"')) return false;
  if (candidate.trim().startsWith('{"__storyH3"')) return true;
  // Heuristic: structured H3 sections (works even if meta lost storyH3 flag).
  return (
    /detailed_description\s*:/i.test(candidate) &&
    /summary\s*:/i.test(candidate)
  );
}

export function savePhotoRestore(payload: PhotoRestorePayload) {
  sessionStorage.setItem(PHOTO_KEY, JSON.stringify(payload));
}

export function loadPhotoRestore(): PhotoRestorePayload | null {
  try {
    const raw = sessionStorage.getItem(PHOTO_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(PHOTO_KEY);
    return JSON.parse(raw) as PhotoRestorePayload;
  } catch {
    return null;
  }
}

export function saveStoryVideoRestore(payload: StoryVideoRestorePayload) {
  sessionStorage.setItem(STORY_VIDEO_KEY, JSON.stringify(payload));
}

export function loadStoryVideoRestore(): StoryVideoRestorePayload | null {
  try {
    const raw = sessionStorage.getItem(STORY_VIDEO_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(STORY_VIDEO_KEY);
    return JSON.parse(raw) as StoryVideoRestorePayload;
  } catch {
    return null;
  }
}

export function buildVideoRestorePayload(opts: {
  title?: string;
  prompt?: string;
  meta?: Record<string, unknown>;
}): VideoRestorePayload {
  const meta = opts.meta || {};
  const runId =
    typeof meta.quickVideoRunId === "string" ? meta.quickVideoRunId : undefined;
  if (runId) return { runId };

  return {
    title: opts.title,
    prompt:
      (typeof meta.shotsJson === "string" && meta.shotsJson) ||
      opts.prompt ||
      undefined,
    shotsJson:
      typeof meta.shotsJson === "string" ? meta.shotsJson : undefined,
    characterIds: meta.characterIds as string[] | undefined,
    customCharacters: meta.customCharacters as
      | Array<{ id: string; name: string }>
      | undefined,
    orientation: meta.orientation as string | undefined,
    durationSec:
      typeof meta.durationSec === "number" ? meta.durationSec : undefined,
    refImageUrls: meta.refImageUrls as string[] | undefined,
    refVideoUrl:
      typeof meta.refVideoUrl === "string" ? meta.refVideoUrl : undefined,
    refSlots: meta.refSlots as QuickVideoImageSlot[] | undefined,
    runId,
  };
}

export function buildStoryVideoRestorePayload(opts: {
  title?: string;
  prompt?: string;
  meta?: Record<string, unknown>;
}): StoryVideoRestorePayload {
  const meta = opts.meta || {};
  const runId =
    typeof meta.quickVideoRunId === "string" ? meta.quickVideoRunId : undefined;
  const shotsJson =
    typeof meta.shotsJson === "string" ? meta.shotsJson : undefined;
  // Story runs store raw H3 in prompt / shotsJson (not __qvShots).
  const prompt =
    (shotsJson && !shotsJson.trim().startsWith('{"__qvShots"')
      ? shotsJson
      : undefined) ||
    opts.prompt ||
    undefined;

  return {
    runId,
    title: opts.title,
    prompt,
    characterIds: meta.characterIds as string[] | undefined,
    orientation: meta.orientation as string | undefined,
    durationSec:
      typeof meta.durationSec === "number" ? meta.durationSec : undefined,
    refImageUrls: meta.refImageUrls as string[] | undefined,
    refVideoUrl:
      typeof meta.refVideoUrl === "string" ? meta.refVideoUrl : undefined,
    refSlots: meta.refSlots as QuickVideoImageSlot[] | undefined,
    storyModelName:
      typeof meta.storyModelName === "string"
        ? meta.storyModelName
        : Array.isArray(meta.customCharacters) &&
            meta.customCharacters[0] &&
            typeof (meta.customCharacters[0] as { name?: string }).name ===
              "string"
          ? (meta.customCharacters[0] as { name: string }).name
          : undefined,
    bodyLookbook:
      meta.bodyLookbook && typeof meta.bodyLookbook === "object"
        ? (meta.bodyLookbook as Record<string, string>)
        : undefined,
  };
}

/** Immediate restore while Quick Video editor is already mounted (no sessionStorage). */
export function requestVideoRestore(payload: VideoRestorePayload) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<VideoRestorePayload>(PEACH_VIDEO_RESTORE_EVENT, {
      detail: payload,
    }),
  );
}

export function requestStoryVideoRestore(payload: StoryVideoRestorePayload) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<StoryVideoRestorePayload>(PEACH_STORY_VIDEO_RESTORE_EVENT, {
      detail: payload,
    }),
  );
}

export function requestVideoTemplateApply(payload: QuickVideoTemplateUsePayload) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<QuickVideoTemplateUsePayload>(
      PEACH_VIDEO_TEMPLATE_APPLY_EVENT,
      { detail: payload },
    ),
  );
}

export function requestPhotoTemplateApply(payload: PeachPhotoTemplateUsePayload) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<PeachPhotoTemplateUsePayload>(
      PEACH_PHOTO_TEMPLATE_APPLY_EVENT,
      { detail: payload },
    ),
  );
}

/** @deprecated use buildVideoRestorePayload + requestVideoRestore */
export function saveVideoRestoreFromRun(payload: { runId: string }) {
  requestVideoRestore({ runId: payload.runId });
}

/** @deprecated use buildVideoRestorePayload + requestVideoRestore */
export function saveVideoRestoreFromGallery(payload: {
  title?: string;
  prompt?: string;
  meta: Record<string, unknown>;
}) {
  requestVideoRestore(
    buildVideoRestorePayload({
      title: payload.title,
      prompt: payload.prompt,
      meta: payload.meta,
    }),
  );
}
