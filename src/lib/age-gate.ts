/**
 * Age / minor safety gate — local OpenCV DNN on Railway (CPU).
 * Does NOT use Metalnode GPU (safe while LoRA train is running).
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "fs";
import path from "path";
import { dataRoot, ensureDataDirs } from "@/lib/paths";
import { getOpsSettings } from "@/lib/ops/settings";
import { characterImagesDir, listCharacterPhotos } from "@/lib/character-dataset";

export type AgeGateResult = {
  ok: boolean;
  blocked: boolean;
  faces?: number;
  ageLabel?: string | null;
  score?: number | null;
  reason?: string;
  error?: string;
  engine?: string;
  skipped?: boolean;
};

export type AgeGateConfig = {
  enabled: boolean;
  /** Comma buckets e.g. (0-2),(4-6),(8-12),(15-20) */
  blockBuckets: string;
  faceThresh: number;
  /** If checker crashes while enabled — block (true) or allow (false) */
  failClosed: boolean;
};

const DEFAULT_BUCKETS = "(0-2),(4-6),(8-12),(15-20)";

export function parseAgeGateConfig(rawJson: string | undefined | null, enabledFlag: boolean): AgeGateConfig {
  let parsed: Partial<AgeGateConfig> = {};
  try {
    parsed = JSON.parse(rawJson || "{}") as Partial<AgeGateConfig>;
  } catch {
    parsed = {};
  }
  return {
    enabled: enabledFlag,
    blockBuckets: String(parsed.blockBuckets || DEFAULT_BUCKETS),
    faceThresh: Number(parsed.faceThresh) > 0 ? Number(parsed.faceThresh) : 0.55,
    failClosed: parsed.failClosed !== false,
  };
}

export async function getAgeGateConfig(): Promise<AgeGateConfig> {
  const s = await getOpsSettings();
  return parseAgeGateConfig(s.ageGateJson, s.ageGateEnabled);
}

function findPython(): string {
  for (const bin of ["python3", "python"]) {
    const r = spawnSync(bin, ["-V"], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 5000,
    });
    if (!(r.error && (r.error as NodeJS.ErrnoException).code === "ENOENT") && r.status === 0) {
      return bin;
    }
  }
  return "python3";
}

function runPython(
  args: string[],
  opts?: { input?: Buffer; timeoutMs?: number },
): Promise<{ code: number; stdout: string; stderr: string }> {
  const bin = findPython();
  const timeoutMs = opts?.timeoutMs ?? 90_000;
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      windowsHide: true,
      env: {
        ...process.env,
        DATA_ROOT: dataRoot(),
        AGE_GATE_MODELS: path.join(dataRoot(), "age-gate"),
        PYTHONUNBUFFERED: "1",
      },
    });
    let stdout = "";
    let stderr = "";
    const t = setTimeout(() => {
      child.kill();
      reject(new Error(`age-gate timeout after ${Math.round(timeoutMs / 1000)}s`));
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
    if (opts?.input) {
      child.stdin.write(opts.input);
      child.stdin.end();
    } else {
      child.stdin.end();
    }
  });
}

let opencvReady: Promise<boolean> | null = null;

/** Best-effort: ensure opencv-python-headless is importable (Railway has pip). */
async function ensureOpenCv(): Promise<boolean> {
  if (!opencvReady) {
    opencvReady = (async () => {
      try {
        const probe = await runPython(["-c", "import cv2,numpy; print('OK')"], {
          timeoutMs: 30_000,
        });
        if (probe.stdout.includes("OK")) return true;
      } catch {
        /* install */
      }
      try {
        const pip = await runPython(
          ["-m", "pip", "install", "--user", "-q", "opencv-python-headless", "numpy"],
          { timeoutMs: 300_000 },
        );
        if (pip.code !== 0) {
          console.error("[age-gate] pip install failed:", pip.stderr.slice(0, 400));
          return false;
        }
        const probe2 = await runPython(["-c", "import cv2,numpy; print('OK')"], {
          timeoutMs: 30_000,
        });
        return probe2.stdout.includes("OK");
      } catch (e) {
        console.error("[age-gate] opencv ensure failed:", e);
        return false;
      }
    })();
  }
  return opencvReady;
}

function scriptPath(): string {
  return path.join(process.cwd(), "scripts", "age-gate-check.py");
}

export async function checkImageBufferAgeGate(
  buf: Buffer,
  cfg?: AgeGateConfig,
): Promise<AgeGateResult> {
  const config = cfg || (await getAgeGateConfig());
  if (!config.enabled) {
    return { ok: true, blocked: false, skipped: true, reason: "disabled" };
  }
  if (!buf?.length || buf.length < 50) {
    return { ok: false, blocked: config.failClosed, error: "empty_image", reason: "empty_image" };
  }

  ensureDataDirs();
  const ready = await ensureOpenCv();
  if (!ready) {
    const msg = "opencv_unavailable";
    console.error("[age-gate]", msg);
    return {
      ok: false,
      blocked: config.failClosed,
      error: msg,
      reason: "checker_unavailable",
    };
  }

  const script = scriptPath();
  if (!fs.existsSync(script)) {
    return {
      ok: false,
      blocked: config.failClosed,
      error: "script_missing",
      reason: "checker_unavailable",
    };
  }

  try {
    const r = await runPython(
      [
        script,
        "--stdin",
        "--block",
        config.blockBuckets,
        "--face-thresh",
        String(config.faceThresh),
      ],
      { input: buf, timeoutMs: 120_000 },
    );
    const line = r.stdout.trim().split(/\r?\n/).filter(Boolean).pop() || "{}";
    const parsed = JSON.parse(line) as AgeGateResult;
    if (!parsed.ok) {
      return {
        ...parsed,
        blocked: config.failClosed ? true : Boolean(parsed.blocked),
        reason: parsed.reason || "checker_error",
      };
    }
    return parsed;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[age-gate] check failed:", msg);
    return {
      ok: false,
      blocked: config.failClosed,
      error: msg,
      reason: "checker_error",
    };
  }
}

export async function checkImageFileAgeGate(
  filePath: string,
  cfg?: AgeGateConfig,
): Promise<AgeGateResult> {
  const buf = fs.readFileSync(filePath);
  return checkImageBufferAgeGate(buf, cfg);
}

/** User-facing error code / message helpers */
export function ageGateBlockMessage(locale: "ru" | "en" = "ru"): string {
  if (locale === "en") {
    return "This photo looks like it may show a minor. For safety we can't use it for generation. Please upload a clear photo of an adult (18+).";
  }
  return "По фото похоже, что на снимке несовершеннолетний. Из соображений безопасности мы не можем использовать его для генерации. Загрузите чёткое фото взрослого человека (18+).";
}

export class AgeGateBlockedError extends Error {
  code = "age_gate_blocked" as const;
  result: AgeGateResult;
  constructor(result: AgeGateResult, locale: "ru" | "en" = "ru") {
    super(ageGateBlockMessage(locale));
    this.result = result;
  }
}

/** Assert buffer is allowed; throws AgeGateBlockedError when blocked. */
export async function assertImageAllowedForGeneration(
  buf: Buffer,
  locale: "ru" | "en" = "ru",
): Promise<AgeGateResult> {
  const result = await checkImageBufferAgeGate(buf);
  if (result.blocked) throw new AgeGateBlockedError(result, locale);
  return result;
}

/** Scan all character dataset photos; throws if any look underage. */
export async function assertCharacterPhotosAllowed(
  characterId: string,
  locale: "ru" | "en" = "ru",
): Promise<AgeGateResult | { skipped: true; ok: true; blocked: false }> {
  const cfg = await getAgeGateConfig();
  if (!cfg.enabled) {
    return { ok: true, blocked: false, skipped: true };
  }
  const photos = listCharacterPhotos(characterId);
  const dir = characterImagesDir(characterId);
  let last: AgeGateResult = { ok: true, blocked: false, reason: "no_photos" };
  for (const p of photos) {
    const abs = path.join(dir, p.name);
    if (!fs.existsSync(abs)) continue;
    last = await checkImageBufferAgeGate(fs.readFileSync(abs), cfg);
    if (last.blocked) throw new AgeGateBlockedError(last, locale);
  }
  return last;
}
