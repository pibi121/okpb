import { readTrainMeta } from "@/lib/character-dataset";
import { formatDuration } from "@/lib/krea-lora-progress";

export type TgTrainProgress = {
  status: string;
  metaStatus: string;
  phase: string;
  percent: number;
  etaSec: number;
  etaMinutes: number;
  estimateTotalSec: number;
  estimateTotalMinutes: number;
  etaLabel: string;
  epoch?: number;
  epochs?: number;
  error?: string;
};

/** Progress payload for Mini App LoRA training cards. */
export function buildTgTrainProgress(
  characterId: string,
  loraStatus: string,
): TgTrainProgress {
  const meta = readTrainMeta(characterId);
  const estimateTotalSec = meta.estimateTotalSec || 90 * 60;
  const elapsedFromStart = meta.startedAt
    ? Math.floor((Date.now() - new Date(meta.startedAt).getTime()) / 1000)
    : 0;
  const etaSec =
    typeof meta.etaSec === "number"
      ? meta.etaSec
      : Math.max(0, estimateTotalSec - elapsedFromStart);
  const percent =
    loraStatus === "lora_ready"
      ? 100
      : typeof meta.percent === "number"
        ? Math.min(99, Math.max(0, meta.percent))
        : meta.startedAt
          ? Math.min(95, Math.round((elapsedFromStart / estimateTotalSec) * 100))
          : 1;

  return {
    status: loraStatus,
    metaStatus: meta.status,
    phase:
      meta.phase ||
      (loraStatus === "lora_training" ? "Подготовка" : meta.status || "idle"),
    percent,
    etaSec,
    etaMinutes: Math.max(1, Math.ceil(Math.max(etaSec, 60) / 60)),
    estimateTotalSec,
    estimateTotalMinutes: Math.max(1, Math.ceil(estimateTotalSec / 60)),
    etaLabel: meta.etaLabel || formatDuration(etaSec),
    epoch: meta.epoch,
    epochs: meta.epochs,
    error: meta.error,
  };
}
