/**
 * Quick Video runs carry enough data to reopen the editor with the same
 * slots, shots, and refs — either via quickVideoRunId or embedded meta.
 */
export function canRestoreVideoMeta(
  meta?: Record<string, unknown> | null,
): boolean {
  if (!meta) return false;
  if (typeof meta.quickVideoRunId === "string" && meta.quickVideoRunId) {
    return true;
  }
  const shots =
    typeof meta.shotsJson === "string" && meta.shotsJson.trim().length > 0;
  if (!shots) return false;
  const refSlots = Array.isArray(meta.refSlots) && meta.refSlots.length > 0;
  const refUrls =
    Array.isArray(meta.refImageUrls) && meta.refImageUrls.length > 0;
  return refSlots || refUrls;
}

export function quickVideoRunIdFromMeta(
  meta?: Record<string, unknown> | null,
): string | null {
  const id = meta?.quickVideoRunId;
  return typeof id === "string" && id ? id : null;
}

export function canSaveQuickVideoTemplate(
  meta?: Record<string, unknown> | null,
): boolean {
  return !!quickVideoRunIdFromMeta(meta);
}
