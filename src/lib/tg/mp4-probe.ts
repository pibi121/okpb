/**
 * Lightweight MP4 size probe for Telegram sendVideo.
 * iOS Telegram renders vertical clips as square when width/height are omitted.
 */

export type Mp4VideoSize = {
  width: number;
  height: number;
  durationSec?: number;
};

function readBoxSize(buf: Buffer, offset: number): { size: number; header: number } {
  let size = buf.readUInt32BE(offset);
  let header = 8;
  if (size === 1) {
    if (offset + 16 > buf.length) return { size: 0, header: 8 };
    size = Number(buf.readBigUInt64BE(offset + 8));
    header = 16;
  } else if (size === 0) {
    size = buf.length - offset;
  }
  return { size, header };
}

function walkBoxes(
  buf: Buffer,
  start: number,
  end: number,
  visit: (type: string, dataStart: number, dataEnd: number) => void,
) {
  let o = start;
  while (o + 8 <= end) {
    const type = buf.toString("ascii", o + 4, o + 8);
    const { size, header } = readBoxSize(buf, o);
    if (size < 8 || o + size > end + 1) break;
    const dataStart = o + header;
    const dataEnd = o + size;
    visit(type, dataStart, dataEnd);
    if (
      type === "moov" ||
      type === "trak" ||
      type === "mdia" ||
      type === "minf" ||
      type === "stbl"
    ) {
      walkBoxes(buf, dataStart, dataEnd, visit);
    }
    o = dataEnd;
  }
}

function tkhdDisplaySize(
  buf: Buffer,
  dataStart: number,
  dataEnd: number,
): { width: number; height: number } | null {
  if (dataEnd - dataStart < 84) return null;
  const ver = buf[dataStart] ?? 0;
  // ISO BMFF tkhd: matrix then width/height as 16.16 fixed-point
  const whOff = ver === 1 ? dataStart + 88 : dataStart + 76;
  if (whOff + 8 > dataEnd) return null;
  const width = Math.round(buf.readUInt32BE(whOff) / 65536);
  const height = Math.round(buf.readUInt32BE(whOff + 4) / 65536);
  if (width < 16 || height < 16 || width > 8192 || height > 8192) return null;
  return { width, height };
}

function mdhdDurationSec(
  buf: Buffer,
  dataStart: number,
  dataEnd: number,
): number | undefined {
  if (dataEnd - dataStart < 24) return undefined;
  const ver = buf[dataStart] ?? 0;
  try {
    if (ver === 1) {
      if (dataEnd - dataStart < 44) return undefined;
      const timescale = buf.readUInt32BE(dataStart + 20);
      const duration = Number(buf.readBigUInt64BE(dataStart + 24));
      if (timescale > 0 && duration > 0) return Math.max(1, Math.round(duration / timescale));
    } else {
      const timescale = buf.readUInt32BE(dataStart + 12);
      const duration = buf.readUInt32BE(dataStart + 16);
      if (timescale > 0 && duration > 0) return Math.max(1, Math.round(duration / timescale));
    }
  } catch {
    return undefined;
  }
  return undefined;
}

/** Parse width/height (and optional duration) from MP4/MOV bytes. */
export function probeMp4VideoSize(bytes: Buffer): Mp4VideoSize | null {
  if (!bytes?.length || bytes.length < 32) return null;
  const candidates: Array<Mp4VideoSize & { area: number }> = [];
  let durationSec: number | undefined;

  walkBoxes(bytes, 0, bytes.length, (type, ds, de) => {
    if (type === "tkhd") {
      const size = tkhdDisplaySize(bytes, ds, de);
      if (size) {
        candidates.push({ ...size, area: size.width * size.height });
      }
    }
    if (type === "mdhd" && durationSec == null) {
      durationSec = mdhdDurationSec(bytes, ds, de);
    }
  });

  if (!candidates.length) return null;
  candidates.sort((a, b) => b.area - a.area);
  const best = candidates[0]!;
  return {
    width: best.width,
    height: best.height,
    ...(durationSec ? { durationSec } : {}),
  };
}

/**
 * Merge Telegram sendVideo width/height/duration from MP4 bytes when missing.
 * Prevents iOS Telegram from showing vertical videos as squares.
 */
export function telegramVideoSizeExtra(
  bytes: Buffer | null | undefined,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  const out = { ...extra };
  const hasW = Number(out.width) > 0;
  const hasH = Number(out.height) > 0;
  if (hasW && hasH) return out;

  const probed = bytes?.length ? probeMp4VideoSize(bytes) : null;
  if (probed) {
    if (!hasW) out.width = probed.width;
    if (!hasH) out.height = probed.height;
    if (out.duration == null && probed.durationSec) {
      out.duration = probed.durationSec;
    }
    return out;
  }

  // Safe portrait default for our funnel / MiniMax outputs when probe fails.
  if (!hasW) out.width = 720;
  if (!hasH) out.height = 1280;
  return out;
}
