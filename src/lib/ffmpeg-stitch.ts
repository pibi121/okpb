/**
 * Local ffmpeg concat — AutoEdit/VHS on the GPU re-encodes every frame and
 * routinely exceeds Comfy wait (14 HD clips > 26 min). Gallery files are already
 * on disk; stitch them here instead.
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let cachedFfmpeg = "";
let cachedFfprobe = "";

function resolveFromWhere(name: string): string {
  try {
    const r = spawnSync("where.exe", [name], { encoding: "utf8", windowsHide: true });
    const line = (r.stdout || "")
      .split(/\r?\n/)
      .map((s) => s.trim())
      .find((s) => s.toLowerCase().endsWith(".exe") && fs.existsSync(s));
    return line || "";
  } catch {
    return "";
  }
}

function ffmpegBin(): string {
  if (cachedFfmpeg) return cachedFfmpeg;
  const env = process.env.FFMPEG_PATH?.trim();
  if (env && fs.existsSync(env)) return (cachedFfmpeg = env);
  cachedFfmpeg = resolveFromWhere("ffmpeg") || "ffmpeg";
  return cachedFfmpeg;
}

function ffprobeBin(): string {
  if (cachedFfprobe) return cachedFfprobe;
  const env = process.env.FFPROBE_PATH?.trim();
  if (env && fs.existsSync(env)) return (cachedFfprobe = env);
  const fromWhere = resolveFromWhere("ffprobe");
  if (fromWhere) return (cachedFfprobe = fromWhere);
  const ff = ffmpegBin();
  if (ff !== "ffmpeg") {
    const probe = ff.replace(/ffmpeg(\.exe)?$/i, (_m, ext: string) => `ffprobe${ext || ""}`);
    if (probe !== ff && fs.existsSync(probe)) return (cachedFfprobe = probe);
  }
  return (cachedFfprobe = "ffprobe");
}

function runTool(
  bin: string,
  args: string[],
  timeoutMs: number,
): Promise<{ code: number; stderr: string; stdout: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    const t = setTimeout(() => {
      child.kill();
      reject(new Error(`${path.basename(bin)} timeout after ${Math.round(timeoutMs / 1000)}s`));
    }, timeoutMs);
    child.stdout.on("data", (d) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("error", (e) => {
      clearTimeout(t);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(t);
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

type Probe = {
  width: number;
  height: number;
  hasAudio: boolean;
  duration: number;
  fps: number;
  nbFrames: number;
};

function parseFps(rate?: string): number {
  if (!rate) return 0;
  const m = /^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/.exec(rate.trim());
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (b > 0 && Number.isFinite(a / b)) return a / b;
  }
  const n = Number(rate);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export async function probeMediaFile(file: string): Promise<Probe> {
  const out = await runTool(
    ffprobeBin(),
    [
      "-v",
      "error",
      "-print_format",
      "json",
      "-show_streams",
      "-show_format",
      file,
    ],
    60_000,
  );
  if (out.code !== 0) {
    throw new Error(`ffprobe failed: ${out.stderr.slice(0, 240)}`);
  }
  const data = JSON.parse(out.stdout || "{}") as {
    streams?: Array<{
      codec_type?: string;
      width?: number;
      height?: number;
      duration?: string;
      nb_frames?: string;
      avg_frame_rate?: string;
      r_frame_rate?: string;
    }>;
    format?: { duration?: string };
  };
  const video = data.streams?.find((s) => s.codec_type === "video");
  const audio = data.streams?.find((s) => s.codec_type === "audio");
  const duration = Number(video?.duration || data.format?.duration || 0);
  const fps =
    parseFps(video?.avg_frame_rate) ||
    parseFps(video?.r_frame_rate) ||
    0;
  const nbFrames = Number(video?.nb_frames || 0);
  return {
    width: video?.width || 768,
    height: video?.height || 1344,
    hasAudio: !!audio,
    duration: Number.isFinite(duration) ? duration : 0,
    fps: Number.isFinite(fps) ? fps : 0,
    nbFrames: Number.isFinite(nbFrames) ? nbFrames : 0,
  };
}

async function probeClip(file: string): Promise<Probe> {
  return probeMediaFile(file);
}

/** Write buffer to a temp file, probe with ffprobe, then delete. */
export async function probeMediaBuffer(
  bytes: Buffer,
  ext: string,
): Promise<Probe> {
  const safeExt = ext.replace(/[^\w.]+/g, "") || ".bin";
  const tmp = path.join(
    os.tmpdir(),
    `peach_probe_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}${safeExt.startsWith(".") ? safeExt : `.${safeExt}`}`,
  );
  fs.writeFileSync(tmp, bytes);
  try {
    return await probeMediaFile(tmp);
  } finally {
    try {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
  }
}

function even(n: number) {
  const x = Math.max(2, Math.round(n));
  return x % 2 === 0 ? x : x + 1;
}

export async function stitchClipsFfmpeg(opts: {
  clipPaths: string[];
  outPath: string;
  trimStartSec?: number;
}): Promise<{ width: number; height: number }> {
  if (opts.clipPaths.length < 2) throw new Error("Нужно минимум два ролика");
  for (const p of opts.clipPaths) {
    if (!fs.existsSync(p)) throw new Error(`клип не найден: ${p}`);
  }

  const probes = await Promise.all(opts.clipPaths.map(probeClip));
  const width = even(probes[0]!.width);
  const height = even(probes[0]!.height);
  const trim = Math.max(0, opts.trimStartSec ?? 0.5);
  const n = opts.clipPaths.length;

  const args: string[] = ["-y", "-hide_banner", "-loglevel", "error"];
  for (const p of opts.clipPaths) {
    if (trim > 0) args.push("-ss", String(trim));
    args.push("-i", p);
  }

  const filters: string[] = [];
  const concatParts: string[] = [];
  for (let i = 0; i < n; i++) {
    filters.push(
      `[${i}:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},fps=24,setsar=1,format=yuv420p[v${i}]`,
    );
    if (probes[i]!.hasAudio) {
      filters.push(
        `[${i}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo[a${i}]`,
      );
    } else {
      const dur = Math.max(1, (probes[i]!.duration || 6) - trim);
      filters.push(
        `anullsrc=channel_layout=stereo:sample_rate=48000,atrim=0:${dur.toFixed(3)},aformat=sample_fmts=fltp[a${i}]`,
      );
    }
    concatParts.push(`[v${i}][a${i}]`);
  }
  filters.push(`${concatParts.join("")}concat=n=${n}:v=1:a=1[v][a]`);

  args.push(
    "-filter_complex",
    filters.join(";"),
    "-map",
    "[v]",
    "-map",
    "[a]",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "18",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-movflags",
    "+faststart",
    opts.outPath,
  );

  // 14×12s HD encode locally is minutes, not hours — 1h is a hard safety net.
  const out = await runTool(ffmpegBin(), args, 3_600_000);
  if (out.code !== 0 || !fs.existsSync(opts.outPath) || fs.statSync(opts.outPath).size < 1000) {
    throw new Error(`ffmpeg stitch failed: ${(out.stderr || out.stdout).slice(-600)}`);
  }
  return { width, height };
}

export function ffmpegStitchTempPath(tag: string) {
  return path.join(os.tmpdir(), `peach_stitch_${tag.replace(/[^\w-]+/g, "_")}.mp4`);
}

/** Concat MP4s without trim/retime — preserves duration of each segment. */
export async function concatMp4sLossless(opts: {
  clipPaths: string[];
  outPath: string;
}): Promise<void> {
  if (opts.clipPaths.length < 1) throw new Error("Нужен хотя бы один клип");
  for (const p of opts.clipPaths) {
    if (!fs.existsSync(p)) throw new Error(`клип не найден: ${p}`);
  }
  if (opts.clipPaths.length === 1) {
    fs.copyFileSync(opts.clipPaths[0]!, opts.outPath);
    return;
  }
  const listPath = path.join(
    os.tmpdir(),
    `peach_concat_${Date.now().toString(36)}.txt`,
  );
  const lines = opts.clipPaths.map((p) => {
    const escaped = p.replace(/\\/g, "/").replace(/'/g, "'\\''");
    return `file '${escaped}'`;
  });
  fs.writeFileSync(listPath, lines.join("\n"), "utf8");
  try {
    const out = await runTool(
      ffmpegBin(),
      [
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        listPath,
        "-c",
        "copy",
        opts.outPath,
      ],
      600_000,
    );
    if (
      out.code !== 0 ||
      !fs.existsSync(opts.outPath) ||
      fs.statSync(opts.outPath).size < 1000
    ) {
      // fallback: re-encode concat
      const out2 = await runTool(
        ffmpegBin(),
        [
          "-y",
          "-hide_banner",
          "-loglevel",
          "error",
          "-f",
          "concat",
          "-safe",
          "0",
          "-i",
          listPath,
          "-c:v",
          "libx264",
          "-pix_fmt",
          "yuv420p",
          "-crf",
          "18",
          "-an",
          opts.outPath,
        ],
        1_800_000,
      );
      if (
        out2.code !== 0 ||
        !fs.existsSync(opts.outPath) ||
        fs.statSync(opts.outPath).size < 1000
      ) {
        throw new Error(
          `ffmpeg concat failed: ${(out2.stderr || out.stderr || "").slice(-600)}`,
        );
      }
    }
  } finally {
    try {
      if (fs.existsSync(listPath)) fs.unlinkSync(listPath);
    } catch {
      /* ignore */
    }
  }
}

/**
 * Extract a single PNG frame at ~`atSec` seconds (clamped; falls back to first frame).
 * Used for safe TG/Mini App video template thumbs — never use identity/ref stills.
 */
export async function extractFrameAtSec(
  videoPath: string,
  atSec = 1,
): Promise<Buffer> {
  if (!fs.existsSync(videoPath)) {
    throw new Error(`extractFrameAtSec: file not found: ${videoPath}`);
  }
  const seek = Math.max(0, Number.isFinite(atSec) ? atSec : 1);
  const outPath = path.join(
    os.tmpdir(),
    `peach_frame_${Date.now().toString(36)}.png`,
  );
  const trySeek = async (ss: number) => {
    const args =
      ss > 0
        ? [
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-ss",
            String(ss),
            "-i",
            videoPath,
            "-vframes",
            "1",
            "-update",
            "1",
            "-q:v",
            "2",
            outPath,
          ]
        : [
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            videoPath,
            "-vframes",
            "1",
            "-update",
            "1",
            "-q:v",
            "2",
            outPath,
          ];
    const result = await runTool(ffmpegBin(), args, 60_000);
    if (
      result.code !== 0 ||
      !fs.existsSync(outPath) ||
      fs.statSync(outPath).size < 100
    ) {
      throw new Error(
        `ffmpeg frame@${ss}s failed: ${(result.stderr || result.stdout).slice(-300)}`,
      );
    }
    return fs.readFileSync(outPath);
  };
  try {
    try {
      return await trySeek(seek);
    } catch {
      if (seek > 0) return await trySeek(0);
      throw new Error("ffmpeg frame extract failed");
    }
  } finally {
    try {
      if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
    } catch {
      /* ignore */
    }
  }
}

/** @deprecated Prefer extractFrameAtSec(path, 1) for public thumbs. */
export async function extractFirstFramePng(videoPath: string): Promise<Buffer> {
  return extractFrameAtSec(videoPath, 0);
}

/**
 * Extract the last video frame as a PNG Buffer using ffmpeg.
 * Used to get a context frame for Ref2V continuity between scenes.
 */
export async function extractLastFramePng(videoPath: string): Promise<Buffer> {
  if (!fs.existsSync(videoPath)) throw new Error(`extractLastFramePng: file not found: ${videoPath}`);
  const outPath = path.join(os.tmpdir(), `peach_lastframe_${Date.now().toString(36)}.png`);
  try {
    const result = await runTool(
      ffmpegBin(),
      [
        "-y", "-hide_banner", "-loglevel", "error",
        "-sseof", "-0.1",
        "-i", videoPath,
        "-vframes", "1",
        "-update", "1",
        "-q:v", "2",
        outPath,
      ],
      60_000,
    );
    if (result.code !== 0 || !fs.existsSync(outPath) || fs.statSync(outPath).size < 100) {
      throw new Error(`ffmpeg last-frame failed: ${(result.stderr || result.stdout).slice(-300)}`);
    }
    return fs.readFileSync(outPath);
  } finally {
    try { if (fs.existsSync(outPath)) fs.unlinkSync(outPath); } catch { /* ignore */ }
  }
}

/** Extract mono WAV (up to maxSec) from a video buffer for MiniMax ref_video_audio. */
export async function extractAudioWavFromVideoBuffer(
  videoBytes: Buffer,
  opts?: { maxSec?: number; ext?: string },
): Promise<Buffer | null> {
  const maxSec = Math.max(1, Math.min(15, opts?.maxSec ?? 12));
  const ext = opts?.ext || ".mp4";
  const tag = Date.now().toString(36);
  const inPath = path.join(os.tmpdir(), `peach_refaud_in_${tag}${ext.startsWith(".") ? ext : `.${ext}`}`);
  const outPath = path.join(os.tmpdir(), `peach_refaud_out_${tag}.wav`);
  fs.writeFileSync(inPath, videoBytes);
  try {
    const result = await runTool(
      ffmpegBin(),
      [
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        inPath,
        "-vn",
        "-ac",
        "1",
        "-ar",
        "44100",
        "-t",
        String(maxSec),
        outPath,
      ],
      120_000,
    );
    if (result.code !== 0 || !fs.existsSync(outPath) || fs.statSync(outPath).size < 200) {
      return null;
    }
    return fs.readFileSync(outPath);
  } catch {
    return null;
  } finally {
    try {
      if (fs.existsSync(inPath)) fs.unlinkSync(inPath);
    } catch {
      /* ignore */
    }
    try {
      if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
    } catch {
      /* ignore */
    }
  }
}
