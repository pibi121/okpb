/** GPU orchestrator shared types. */

export type GpuPool = "photo" | "video" | "lora" | "any";

export type GpuJobKind =
  | "photo"
  | "video"
  | "clip"
  | "film"
  | "lora_i2v"
  | "lora_train"
  | "identity_pack"
  | "other";

export type GpuJobStage =
  | "queued"
  | "assigned"
  | "running"
  | "download"
  | "notify"
  | "done"
  | "error";

export type TimelineEvent = {
  at: string;
  stage: string;
  detail?: string;
};

export type GpuEnqueueOpts = {
  kind?: GpuJobKind | string;
  pool?: GpuPool;
  userId?: string | null;
  refType?: string;
  refId?: string;
  title?: string;
  meta?: Record<string, unknown>;
  /** Only assign workers with these providers (e.g. ["metalnode"] for H3 undress). */
  providers?: string[];
  /** Never assign these providers (e.g. ["runpod"] until H3 CLIP is on the burst image). */
  excludeProviders?: string[];
};

export const BUILD_VERSION = "tg-ready-v50-ops-harden";
