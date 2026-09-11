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
};

export const BUILD_VERSION = "tg-ready-v49-meta-strip";
