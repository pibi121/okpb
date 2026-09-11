/**
 * Strip GPS/EXIF/Comfy workflow text from media without re-encoding pixels.
 * On parse failure returns the original buffer so generation never breaks.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function asBuf(bytes: Buffer): Buffer {
  return Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
}

function u32be(buf: Buffer, i: number) {
  return buf.readUInt32BE(i);
}

function u32le(buf: Buffer, i: number) {
  return buf.readUInt32LE(i);
}

/** JPEG: drop APP1 (EXIF/XMP), APP13 (IPTC), COM. Keep SOF/DHT/SOS/APP0/ICC. */
export function stripJpegMetadata(bytes: Buffer): Buffer {
  const buf = asBuf(bytes);
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return buf;
  const out: Buffer[] = [buf.subarray(0, 2)];
  let i = 2;
  while (i + 1 < buf.length) {
    if (buf[i] !== 0xff) return buf;
    while (i < buf.length && buf[i] === 0xff) i += 1;
    if (i >= buf.length) return buf;
    const marker = buf[i]!;
    i += 1;
    if (marker === 0xda) {
      out.push(Buffer.from([0xff, 0xda]));
      out.push(buf.subarray(i));
      return Buffer.concat(out);
    }
    if (marker === 0xd9) {
      out.push(Buffer.from([0xff, 0xd9]));
      return Buffer.concat(out);
    }
    if (marker >= 0xd0 && marker <= 0xd7) {
      out.push(Buffer.from([0xff, marker]));
      continue;
    }
    if (i + 1 >= buf.length) return buf;
    const len = (buf[i]! << 8) | buf[i + 1]!;
    if (len < 2 || i + len > buf.length) return buf;
    const drop = marker === 0xe1 || marker === 0xed || marker === 0xfe;
    if (!drop) {
      out.push(Buffer.from([0xff, marker]));
      out.push(buf.subarray(i, i + len));
    }
    i += len;
  }
  return Buffer.concat(out);
}

const PNG_STRIP = new Set(["tEXt", "zTXt", "iTXt", "eXIf", "tIME"]);

export function stripPngMetadata(bytes: Buffer): Buffer {
  const buf = asBuf(bytes);
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (buf.length < 16 || !buf.subarray(0, 8).equals(sig)) return buf;
  const out: Buffer[] = [buf.subarray(0, 8)];
  let i = 8;
  while (i + 12 <= buf.length) {
    const len = u32be(buf, i);
    const type = buf.subarray(i + 4, i + 8).toString("ascii");
    const total = 12 + len;
    if (len < 0 || i + total > buf.length) return buf;
    if (!PNG_STRIP.has(type)) out.push(buf.subarray(i, i + total));
    i += total;
    if (type === "IEND") return Buffer.concat(out);
  }
  return buf;
}

/** WebP: drop EXIF / XMP RIFF chunks. */
export function stripWebpMetadata(bytes: Buffer): Buffer {
  const buf = asBuf(bytes);
  if (buf.length < 12) return buf;
  if (buf.subarray(0, 4).toString("ascii") !== "RIFF") return buf;
  if (buf.subarray(8, 12).toString("ascii") !== "WEBP") return buf;
  const chunks: Buffer[] = [];
  let i = 12;
  while (i + 8 <= buf.length) {
    const fourcc = buf.subarray(i, i + 4).toString("ascii");
    const size = u32le(buf, i + 4);
    const payload = 8 + size + (size % 2);
    if (size < 0 || i + payload > buf.length) return buf;
    if (fourcc !== "EXIF" && fourcc !== "XMP ") {
      chunks.push(buf.subarray(i, i + payload));
    }
    i += payload;
  }
  const body = Buffer.concat(chunks);
  const header = Buffer.alloc(12);
  header.write("RIFF", 0);
  header.writeUInt32LE(body.length + 4, 4);
  header.write("WEBP", 8);
  return Buffer.concat([header, body]);
}

export function stripImageMetadata(bytes: Buffer): Buffer {
  const buf = asBuf(bytes);
  try {
    let out = buf;
    if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8) {
      out = stripJpegMetadata(buf);
    } else if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e) {
      out = stripPngMetadata(buf);
    } else if (buf.length >= 12 && buf.subarray(8, 12).toString("ascii") === "WEBP") {
      out = stripWebpMetadata(buf);
    }
    return out.length >= 24 ? out : buf;
  } catch {
    return buf;
  }
}

function resolveFfmpeg(): string {
  const env = process.env.FFMPEG_PATH?.trim();
  if (env && fs.existsSync(env)) return env;
  if (process.platform === "win32") {
    try {
      const r = spawnSync("where.exe", ["ffmpeg"], {
        encoding: "utf8",
        windowsHide: true,
        timeout: 5000,
      });
      const line = (r.stdout || "")
        .split(/\r?\n/)
        .map((s) => s.trim())
        .find((s) => s.toLowerCase().endsWith(".exe") && fs.existsSync(s));
      if (line) return line;
    } catch {
      /* ignore */
    }
  }
  return "ffmpeg";
}

/** MP4/MOV: stream-copy, drop container tags. No re-encode. */
export function stripVideoContainerMetadata(bytes: Buffer): Buffer {
  const buf = asBuf(bytes);
  if (buf.length < 1000) return buf;
  const tmpIn = path.join(
    os.tmpdir(),
    `peach_meta_in_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}.mp4`,
  );
  const tmpOut = path.join(
    os.tmpdir(),
    `peach_meta_out_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}.mp4`,
  );
  try {
    fs.writeFileSync(tmpIn, buf);
    const r = spawnSync(
      resolveFfmpeg(),
      [
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        tmpIn,
        "-map_metadata",
        "-1",
        "-c",
        "copy",
        tmpOut,
      ],
      { windowsHide: true, timeout: 20_000, encoding: "utf8" },
    );
    if (r.status === 0 && fs.existsSync(tmpOut) && fs.statSync(tmpOut).size > 500) {
      return fs.readFileSync(tmpOut);
    }
  } catch {
    /* keep original */
  } finally {
    try {
      fs.unlinkSync(tmpIn);
    } catch {
      /* ignore */
    }
    try {
      fs.unlinkSync(tmpOut);
    } catch {
      /* ignore */
    }
  }
  return buf;
}

export function stripMediaMetadata(bytes: Buffer, ext = ""): Buffer {
  const e = ext.replace(/^\./, "").toLowerCase();
  try {
    if (e === "jpg" || e === "jpeg" || e === "png" || e === "webp") {
      return stripImageMetadata(bytes);
    }
    if (e === "mp4" || e === "mov" || e === "webm" || e === "m4v") {
      const cleaned = stripVideoContainerMetadata(bytes);
      return cleaned.length > 500 ? cleaned : bytes;
    }
    return stripImageMetadata(bytes);
  } catch {
    return asBuf(bytes);
  }
}
