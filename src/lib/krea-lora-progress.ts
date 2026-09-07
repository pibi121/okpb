/** Progress / ETA helpers for character model training. */

export function estimateTrainTotalSec(epochs: number) {
  const e = Math.min(20, Math.max(4, Math.round(epochs || 12)));
  // Empirically ~2h for 12 epochs (cache + train) on Metalnode H100-class.
  const cacheSec = 25 * 60;
  const wrapSec = 3 * 60;
  const perEpochSec = 7.5 * 60;
  return cacheSec + wrapSec + e * perEpochSec;
}

export function formatDuration(sec: number) {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) return `${h}ч ${m}м`;
  if (m > 0) return `${m}м ${r}с`;
  return `${r}с`;
}

export type ParsedTrainProgress = {
  phase: string;
  percent: number;
  epoch?: number;
  epochs?: number;
  lastLine?: string;
};

/**
 * Map Metalnode train log markers → percent.
 * Upload is tracked separately (status=uploading).
 */
export function parseKreaTrainLog(
  logText: string,
  opts?: { epochs?: number; status?: string },
): ParsedTrainProgress {
  const epochs = opts?.epochs || 12;
  const text = logText || "";
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const lastLine = lines[lines.length - 1];

  if (opts?.status === "uploading") {
    return { phase: "Загрузка фото…", percent: 5, epochs, lastLine };
  }

  if (/TRAIN_DONE|ALL_DONE/.test(text)) {
    return { phase: "Готово", percent: 100, epochs, epoch: epochs, lastLine: "TRAIN_DONE" };
  }
  if (/PROMOTED|RESTART_COMFY/.test(text) && !/TRAIN_DONE/.test(text)) {
    return { phase: "Почти готово…", percent: 97, epochs, epoch: epochs, lastLine };
  }

  // epoch parsers (musubi / accelerate / custom)
  let epoch: number | undefined;
  const epochMatchers = [
    /epoch\s*[\[:]?\s*(\d+)\s*\/\s*(\d+)/i,
    /epochs?\s*[:=]\s*(\d+)\s*\/\s*(\d+)/i,
    /(\d+)\s*\/\s*(\d+)\s*epoch/i,
  ];
  for (const re of epochMatchers) {
    const matches = [...text.matchAll(new RegExp(re.source, "gi"))];
    const last = matches[matches.length - 1];
    if (last) {
      epoch = Math.min(Number(last[1]), Number(last[2]) || epochs);
      break;
    }
  }

  const stepMatches = [...text.matchAll(new RegExp(String.raw`steps:\s*\d+%[^|\n|]*\|\s*(\d+)\/(\d+)`, "g"))];
  const lastStep = stepMatches[stepMatches.length - 1];
  if (/TRAIN_START/.test(text) && lastStep) {
    const curStep = Number(lastStep[1]);
    const totalSteps = Math.max(1, Number(lastStep[2]));
    const frac = Math.min(1, curStep / totalSteps);
    const percent = Math.round(40 + frac * 56);
    const stepEpoch = Math.max(1, Math.ceil((curStep / totalSteps) * epochs));
    return {
      phase: `Обучение · шаг ${curStep}/${totalSteps}`,
      percent,
      epoch: stepEpoch,
      epochs,
      lastLine,
    };
  }

  if (/TRAIN_START/.test(text) || epoch != null) {
    const cur = Math.max(0, Math.min(epochs, epoch || 0));
    // train window 40% → 96%
    const frac = cur / Math.max(1, epochs);
    const percent = Math.round(40 + frac * 56);
    return {
      phase: cur > 0 ? `Обучение · ${cur}/${epochs}` : "Обучение…",
      percent,
      epoch: cur || undefined,
      epochs,
      lastLine,
    };
  }

  if (/CACHE_TE_OK/.test(text)) {
    return { phase: "Подготовка почти готова", percent: 38, epochs, lastLine };
  }
  if (/CACHE_TE/.test(text)) {
    return { phase: "Подготовка…", percent: 30, epochs, lastLine };
  }
  if (/CACHE_LATENTS_OK/.test(text)) {
    return { phase: "Обработка фото готова", percent: 26, epochs, lastLine };
  }
  if (/CACHE_LATENTS/.test(text)) {
    return { phase: "Обработка фото…", percent: 18, epochs, lastLine };
  }
  if (/STOP_COMFY|START |IMAGES /.test(text)) {
    return { phase: "Подготовка…", percent: 12, epochs, lastLine };
  }

  return {
    phase: "Ожидание…",
    percent: opts?.status === "training" ? 10 : 0,
    epochs,
    lastLine,
  };
}

export function withTiming(
  progress: ParsedTrainProgress,
  startedAt?: string,
  estimateTotalSec?: number,
): ParsedTrainProgress & {
  elapsedSec: number;
  estimateTotalSec: number;
  etaSec: number;
  etaLabel: string;
} {
  const elapsedSec = startedAt
    ? Math.max(0, Math.round((Date.now() - Date.parse(startedAt)) / 1000))
    : 0;
  const total = estimateTotalSec || estimateTrainTotalSec(progress.epochs || 12);
  const etaSec = Math.max(0, total - elapsedSec);
  return {
    ...progress,
    elapsedSec,
    estimateTotalSec: total,
    etaSec,
    etaLabel: formatDuration(etaSec),
  };
}
