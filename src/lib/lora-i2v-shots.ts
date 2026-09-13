/**
 * Multi-shot LoRA→I2V recipe (lab forms × N → stitch → template).
 */
export type LoraI2vShotSpec = {
  id: string;
  stillPrompt: string;
  i2vPrompt: string;
  negativePrompt?: string;
  durationSec: number;
};

export type LoraI2vShotsPlan = {
  __li2vShots: 1;
  totalDurationSec: number;
  shots: LoraI2vShotSpec[];
  /**
   * If true, last shot still generates, but its duration is excluded from 🍑 price
   * (unstable freebie / WIP shot).
   */
  billingWaiveLastShot?: boolean;
};

export function clampLoraI2vDurationSec(n: number | null | undefined) {
  return Math.min(3600, Math.max(4, Math.round(Number(n) || 6)));
}

export function clampShotDurationSec(n: number | null | undefined) {
  return Math.min(12, Math.max(4, Math.round(Number(n) || 6)));
}

export function newLoraI2vShotId() {
  return `shot-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function emptyLoraI2vShot(
  partial?: Partial<LoraI2vShotSpec>,
): LoraI2vShotSpec {
  return {
    id: partial?.id || newLoraI2vShotId(),
    stillPrompt: partial?.stillPrompt || "",
    i2vPrompt: partial?.i2vPrompt || "",
    negativePrompt: partial?.negativePrompt || "",
    durationSec: clampShotDurationSec(partial?.durationSec),
  };
}

export function buildLoraI2vShotsPlan(
  shots: LoraI2vShotSpec[],
  opts?: { billingWaiveLastShot?: boolean },
): LoraI2vShotsPlan {
  const cleaned = shots
    .map((s) => ({
      id: s.id || newLoraI2vShotId(),
      stillPrompt: (s.stillPrompt || "").trim(),
      i2vPrompt: (s.i2vPrompt || "").trim(),
      negativePrompt: (s.negativePrompt || "").trim(),
      durationSec: clampShotDurationSec(s.durationSec),
    }))
    .filter((s) => s.stillPrompt && s.i2vPrompt);
  const totalDurationSec = cleaned.reduce(
    (sum, s) => sum + s.durationSec,
    0,
  );
  return {
    __li2vShots: 1,
    totalDurationSec: clampLoraI2vDurationSec(totalDurationSec || 6),
    shots: cleaned,
    ...(opts?.billingWaiveLastShot ? { billingWaiveLastShot: true } : {}),
  };
}

/** Duration used for 🍑 charge (may omit last shot if waived). */
export function billableDurationSecForLoraI2v(opts: {
  durationSec?: number | null;
  shotsJson?: string | null;
}): number {
  const plan = parseLoraI2vShotsPlan(opts.shotsJson);
  const full = clampLoraI2vDurationSec(
    plan?.totalDurationSec || opts.durationSec || 6,
  );
  if (!plan?.billingWaiveLastShot || plan.shots.length < 2) return full;
  const last = plan.shots[plan.shots.length - 1]!;
  const waived = Math.max(0, full - last.durationSec);
  return clampLoraI2vDurationSec(waived || full);
}

export function serializeLoraI2vShotsPlan(plan: LoraI2vShotsPlan): string {
  return JSON.stringify(plan);
}

export function parseLoraI2vShotsPlan(
  raw: string | null | undefined,
): LoraI2vShotsPlan | null {
  const text = (raw || "").trim();
  if (!text) return null;
  try {
    const data = JSON.parse(text) as Partial<LoraI2vShotsPlan>;
    if (!data || data.__li2vShots !== 1 || !Array.isArray(data.shots)) {
      return null;
    }
    const shots = data.shots
      .map((s) =>
        emptyLoraI2vShot({
          id: String(s?.id || ""),
          stillPrompt: String(s?.stillPrompt || ""),
          i2vPrompt: String(s?.i2vPrompt || ""),
          negativePrompt: String(s?.negativePrompt || ""),
          durationSec: Number(s?.durationSec) || 6,
        }),
      )
      .filter((s) => s.stillPrompt.trim() && s.i2vPrompt.trim());
    if (!shots.length) return null;
    return buildLoraI2vShotsPlan(shots, {
      billingWaiveLastShot: Boolean(data.billingWaiveLastShot),
    });
  } catch {
    return null;
  }
}

/** Prefer shotsJson; fall back to single-shot still/i2v fields. */
export function resolveLoraI2vShots(opts: {
  shotsJson?: string | null;
  stillPrompt?: string | null;
  i2vPrompt?: string | null;
  negativePrompt?: string | null;
  durationSec?: number | null;
}): LoraI2vShotSpec[] {
  const fromJson = parseLoraI2vShotsPlan(opts.shotsJson);
  if (fromJson?.shots.length) return fromJson.shots;
  const still = (opts.stillPrompt || "").trim();
  const i2v = (opts.i2vPrompt || "").trim();
  if (!still || !i2v) return [];
  return [
    emptyLoraI2vShot({
      id: "shot-1",
      stillPrompt: still,
      i2vPrompt: i2v,
      negativePrompt: opts.negativePrompt || "",
      durationSec: opts.durationSec || 6,
    }),
  ];
}
