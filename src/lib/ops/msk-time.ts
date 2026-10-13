/** Europe/Moscow helpers (fixed UTC+3, no DST). */

const MSK_OFFSET_MS = 3 * 3600_000;

export function mskWall(d: Date) {
  const shifted = new Date(d.getTime() + MSK_OFFSET_MS);
  return {
    y: shifted.getUTCFullYear(),
    mo: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
    h: shifted.getUTCHours(),
    mi: shifted.getUTCMinutes(),
  };
}

/** Build a UTC Date from a Moscow wall-clock. */
export function mskUtc(
  y: number,
  mo: number,
  day: number,
  h: number,
  mi = 0,
  sec = 0,
) {
  return new Date(Date.UTC(y, mo, day, h - 3, mi, sec, 0));
}

/**
 * Parse `<input type="datetime-local">` value as Moscow time → UTC Date.
 * Accepts `YYYY-MM-DDTHH:mm` or `YYYY-MM-DDTHH:mm:ss`.
 */
export function parseMskDateTimeLocal(raw: string): Date | null {
  const s = raw.trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(
    s,
  );
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const day = Number(m[3]);
  const h = Number(m[4]);
  const mi = Number(m[5]);
  const sec = Number(m[6] || 0);
  if (
    !Number.isFinite(y) ||
    mo < 0 ||
    mo > 11 ||
    day < 1 ||
    day > 31 ||
    h < 0 ||
    h > 23 ||
    mi < 0 ||
    mi > 59
  ) {
    return null;
  }
  return mskUtc(y, mo, day, h, mi, sec);
}

/** Format UTC Date as datetime-local string in Moscow (`YYYY-MM-DDTHH:mm`). */
export function toMskDateTimeLocal(d: Date): string {
  const w = mskWall(d);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${w.y}-${pad(w.mo + 1)}-${pad(w.day)}T${pad(w.h)}:${pad(w.mi)}`;
}
