/**
 * Tease delivery: blur + centered PNG overlay (no-balance TG preview).
 * Lab tunes these knobs; undress/TG will read the preset later.
 */

export type TeaseOverlayPreset = {
  version: 1;
  /** Canvas/CSS blur radius in px at preview scale; server maps to sharp sigma. */
  blurPx: number;
  /** Overlay width as fraction of min(photoW, photoH), 0.15–1.2 */
  overlayScale: number;
  /** 0–1 */
  overlayOpacity: number;
  /** Center of overlay, 0–1 relative to photo */
  overlayX: number;
  overlayY: number;
  /** Filename under presets/ (uploaded via lab) */
  overlayFile: string;
  updatedAt?: string;
  notes?: string;
};

export const TEASE_PRESET_PATH = "presets/tease_overlay.json";
export const TEASE_OVERLAY_DEFAULT_FILE = "tease_cta.png";

export const DEFAULT_TEASE_PRESET: TeaseOverlayPreset = {
  version: 1,
  blurPx: 18,
  overlayScale: 0.55,
  overlayOpacity: 0.95,
  overlayX: 0.5,
  overlayY: 0.5,
  overlayFile: TEASE_OVERLAY_DEFAULT_FILE,
  notes: "Tuned in /peach/tease-lab",
};

export function clampTeasePreset(
  raw: Partial<TeaseOverlayPreset> | null | undefined,
): TeaseOverlayPreset {
  const d = DEFAULT_TEASE_PRESET;
  const n = (v: unknown, fallback: number, min: number, max: number) => {
    const x = typeof v === "number" ? v : Number(v);
    if (!Number.isFinite(x)) return fallback;
    return Math.min(max, Math.max(min, x));
  };
  return {
    version: 1,
    blurPx: n(raw?.blurPx, d.blurPx, 0, 80),
    overlayScale: n(raw?.overlayScale, d.overlayScale, 0.1, 1.5),
    overlayOpacity: n(raw?.overlayOpacity, d.overlayOpacity, 0, 1),
    overlayX: n(raw?.overlayX, d.overlayX, 0, 1),
    overlayY: n(raw?.overlayY, d.overlayY, 0, 1),
    overlayFile:
      typeof raw?.overlayFile === "string" && raw.overlayFile.trim()
        ? raw.overlayFile.trim().replace(/[/\\]/g, "").slice(0, 120)
        : d.overlayFile,
    updatedAt: typeof raw?.updatedAt === "string" ? raw.updatedAt : undefined,
    notes: typeof raw?.notes === "string" ? raw.notes.slice(0, 500) : d.notes,
  };
}

/** sharp blur sigma ≈ blurPx * 0.4 (lab preview uses CSS px). */
export function teaseBlurSigma(blurPx: number): number {
  return Math.max(0.3, blurPx * 0.4);
}
