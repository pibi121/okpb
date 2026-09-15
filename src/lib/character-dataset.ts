import fs from "fs";
import path from "path";
import { dataRoot } from "@/lib/paths";
import { stripMediaMetadata } from "@/lib/strip-media-metadata";

const IMG_EXT = new Set([".png", ".jpg", ".jpeg", ".webp"]);

export function characterRoot(characterId: string) {
  return path.join(dataRoot(), "characters", characterId);
}

export function characterImagesDir(characterId: string) {
  return path.join(characterRoot(characterId), "images");
}

export function characterTrainingArchiveDir(characterId: string) {
  return path.join(characterRoot(characterId), "training-archive");
}

function trainingArchivedFlagPath(characterId: string) {
  return path.join(characterRoot(characterId), "training-archived.flag");
}

/** Training photos were moved out of the visible dataset folder. */
export function trainingPhotosArchived(characterId: string): boolean {
  return fs.existsSync(trainingArchivedFlagPath(characterId));
}

/** Move LoRA training photos + captions to training-archive/ (kept on disk, hidden from UI). */
export function archiveTrainingPhotos(characterId: string): number {
  ensureCharacterDirs(characterId);
  const src = characterImagesDir(characterId);
  const dst = characterTrainingArchiveDir(characterId);
  fs.mkdirSync(dst, { recursive: true });
  let moved = 0;
  for (const f of fs.readdirSync(src)) {
    const ext = path.extname(f).toLowerCase();
    if (!IMG_EXT.has(ext) && ext !== ".txt") continue;
    const from = path.join(src, f);
    const to = path.join(dst, f);
    if (fs.existsSync(to)) fs.unlinkSync(to);
    fs.renameSync(from, to);
    moved++;
  }
  fs.writeFileSync(trainingArchivedFlagPath(characterId), new Date().toISOString(), "utf8");
  return moved;
}

/** Restore archived training photos back into the visible dataset folder. */
export function restoreTrainingPhotos(characterId: string): number {
  ensureCharacterDirs(characterId);
  const src = characterTrainingArchiveDir(characterId);
  const dst = characterImagesDir(characterId);
  if (!fs.existsSync(src)) return 0;
  let moved = 0;
  for (const f of fs.readdirSync(src)) {
    const ext = path.extname(f).toLowerCase();
    if (!IMG_EXT.has(ext) && ext !== ".txt") continue;
    const from = path.join(src, f);
    const to = path.join(dst, f);
    if (fs.existsSync(to)) fs.unlinkSync(to);
    fs.renameSync(from, to);
    moved++;
  }
  const flag = trainingArchivedFlagPath(characterId);
  if (fs.existsSync(flag)) fs.unlinkSync(flag);
  return moved;
}

export function characterTrainMetaPath(characterId: string) {
  return path.join(characterRoot(characterId), "train.json");
}

export type CharacterTrainMeta = {
  status: "idle" | "uploading" | "training" | "ready" | "error";
  trigger?: string;
  slug?: string;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
  remoteLog?: string;
  loraPath?: string;
  lastLine?: string;
  /** Human phase label */
  phase?: string;
  /** 0–100 */
  percent?: number;
  /** Planned train epochs */
  epochs?: number;
  /** Current epoch (1-based) if known */
  epoch?: number;
  /** Elapsed seconds since start */
  elapsedSec?: number;
  /** Estimated total seconds */
  estimateTotalSec?: number;
  /** Remaining seconds (clamped ≥0) */
  etaSec?: number;
  /** Short ETA string for UI */
  etaLabel?: string;
  /** Started from TG bot onboarding — send ready notification */
  tgNotify?: boolean;
  tgNotified?: boolean;
};

export function ensureCharacterDirs(characterId: string) {
  fs.mkdirSync(characterImagesDir(characterId), { recursive: true });
}

/** Cyrillic → latin so RU character names become valid LoRA triggers. */
const CYR_TO_LAT: Record<string, string> = {
  а: "a",
  б: "b",
  в: "v",
  г: "g",
  д: "d",
  е: "e",
  ё: "e",
  ж: "zh",
  з: "z",
  и: "i",
  й: "y",
  к: "k",
  л: "l",
  м: "m",
  н: "n",
  о: "o",
  п: "p",
  р: "r",
  с: "s",
  т: "t",
  у: "u",
  ф: "f",
  х: "h",
  ц: "ts",
  ч: "ch",
  ш: "sh",
  щ: "sch",
  ъ: "",
  ы: "y",
  ь: "",
  э: "e",
  ю: "yu",
  я: "ya",
};

export function transliterateToAscii(raw: string): string {
  let out = "";
  for (const ch of raw) {
    const lower = ch.toLowerCase();
    if (Object.prototype.hasOwnProperty.call(CYR_TO_LAT, lower)) {
      out += CYR_TO_LAT[lower];
    } else {
      out += ch;
    }
  }
  return out;
}

/**
 * LoRA trigger / remote slug: [a-z][a-z0-9_]{2,31}.
 * Accepts Cyrillic names (transliterated). If still invalid, uses `ch_<idTail>`.
 */
export function sanitizeTrigger(raw: string, fallbackId?: string): string {
  let t = transliterateToAscii(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");

  if (t && !/^[a-z]/.test(t)) {
    t = `c_${t}`.replace(/_+/g, "_");
  }
  if (t.length > 32) {
    t = t.slice(0, 32).replace(/_+$/g, "");
  }

  if (t.length < 3) {
    const idTail = (fallbackId || "")
      .replace(/[^a-z0-9]/gi, "")
      .toLowerCase()
      .slice(-10);
    t = `ch_${idTail || "model"}`.slice(0, 32);
  }

  if (t.length < 3 || t.length > 32 || !/^[a-z][a-z0-9_]*$/.test(t)) {
    throw new Error("trigger: 3–32 символов [a-z0-9_]");
  }
  return t;
}

export function listCharacterPhotos(characterId: string) {
  ensureCharacterDirs(characterId);
  const dir = characterImagesDir(characterId);
  return fs
    .readdirSync(dir)
    .filter((f) => IMG_EXT.has(path.extname(f).toLowerCase()))
    .sort()
    .map((name) => {
      const abs = path.join(dir, name);
      const st = fs.statSync(abs);
      return {
        name,
        size: st.size,
        url: `/api/characters/${characterId}/photos/${encodeURIComponent(name)}`,
      };
    });
}

/** Prefer magic bytes over phone filenames (image.heic / no extension). */
function resolveImageExt(filename: string, bytes: Buffer): string {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return ".jpg";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return ".png";
  }
  if (
    bytes.length >= 12 &&
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP"
  ) {
    return ".webp";
  }
  if (bytes.length >= 12 && bytes.toString("ascii", 4, 8) === "ftyp") {
    const brand = bytes.toString("ascii", 8, 12).toLowerCase();
    if (["heic", "heif", "mif1", "msf1"].some((b) => brand.includes(b) || brand === b)) {
      throw new Error(
        "HEIC не поддерживается — в iPhone: Настройки → Камера → Форматы → Наибольшая совместимость",
      );
    }
  }
  const safe = filename.replace(/[^\w.\-]+/g, "_");
  const ext = path.extname(safe).toLowerCase();
  if (IMG_EXT.has(ext)) return ext;
  throw new Error("нужен png/jpg/webp");
}

export function saveCharacterPhoto(
  characterId: string,
  filename: string,
  bytes: Buffer,
  triggerWord?: string | null,
) {
  ensureCharacterDirs(characterId);
  const ext = resolveImageExt(filename, bytes);
  const base = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const name = `${base}${ext}`;
  const abs = path.join(characterImagesDir(characterId), name);
  fs.writeFileSync(abs, stripMediaMetadata(bytes, ext));
  const caption = (triggerWord || "person").trim() || "person";
  fs.writeFileSync(path.join(characterImagesDir(characterId), `${base}.txt`), `${caption}\n`, "utf8");
  return name;
}

export function deleteCharacterPhoto(characterId: string, name: string) {
  const safe = path.basename(name);
  const abs = path.join(characterImagesDir(characterId), safe);
  if (!abs.startsWith(characterImagesDir(characterId))) throw new Error("bad path");
  if (fs.existsSync(abs)) fs.unlinkSync(abs);
  const base = safe.replace(/\.[^.]+$/, "");
  const txt = path.join(characterImagesDir(characterId), `${base}.txt`);
  if (fs.existsSync(txt)) fs.unlinkSync(txt);
}

export function readTrainMeta(characterId: string): CharacterTrainMeta {
  const p = characterTrainMetaPath(characterId);
  if (!fs.existsSync(p)) return { status: "idle" };
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")) as CharacterTrainMeta;
  } catch {
    return { status: "idle" };
  }
}

export function writeTrainMeta(characterId: string, meta: CharacterTrainMeta) {
  ensureCharacterDirs(characterId);
  fs.writeFileSync(characterTrainMetaPath(characterId), JSON.stringify(meta, null, 2), "utf8");
}

export function rewriteCaptions(characterId: string, trigger: string) {
  const dir = characterImagesDir(characterId);
  for (const f of fs.readdirSync(dir)) {
    if (!IMG_EXT.has(path.extname(f).toLowerCase())) continue;
    const base = f.replace(/\.[^.]+$/, "");
    fs.writeFileSync(path.join(dir, `${base}.txt`), `${trigger}\n`, "utf8");
  }
}
