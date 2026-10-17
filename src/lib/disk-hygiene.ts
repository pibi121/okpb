import fs from "fs";
import path from "path";
import { dataRoot, galleryRoot, backupsRoot } from "@/lib/paths";

export type DiskFreeResult = {
  deleted: number;
  freed: number;
  beforeBytes: number;
  afterBytes: number;
  df: string;
};

type FileEntry = { path: string; size: number; mtime: number };

/** Soft target free space on the Railway volume (~10 GB). */
const TARGET_FREE_MB_DEFAULT = 2048;
/** Keep a few SQLite copies — each is a full prod.db clone. */
const BACKUP_KEEP_NORMAL = 3;
const BACKUP_KEEP_EMERGENCY = 1;
/** Emergency-only: drop gallery videos older than this (never mass-delete recent paid work). */
const EMERGENCY_VIDEO_MIN_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const EMERGENCY_VIDEO_MIN_BYTES = Math.floor(1.5 * 1024 * 1024);

function walkFiles(dir: string, out: FileEntry[], depth = 0) {
  if (depth > 10 || !fs.existsSync(dir)) return;
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    try {
      if (e.isDirectory()) walkFiles(full, out, depth + 1);
      else if (e.isFile()) {
        const st = fs.statSync(full);
        out.push({ path: full, size: st.size, mtime: st.mtimeMs });
      }
    } catch {
      /* skip */
    }
  }
}

function dfSnapshot(): string {
  try {
    const { execSync } = require("node:child_process") as typeof import("node:child_process");
    return execSync("df -h /app/data /tmp / 2>/dev/null || df -h", {
      encoding: "utf8",
      timeout: 5000,
    }).slice(0, 800);
  } catch {
    return "df_unavailable";
  }
}

/** Parse `df -P` for /app/data (1K-blocks). */
export function parseDataVolumeDf(): {
  sizeKb: number;
  usedKb: number;
  availKb: number;
  usedPct: number;
} | null {
  try {
    const { execSync } = require("node:child_process") as typeof import("node:child_process");
    const out = execSync("df -P /app/data 2>/dev/null || df -P .", {
      encoding: "utf8",
      timeout: 4000,
    });
    const line = out.trim().split(/\r?\n/).pop() || "";
    const parts = line.split(/\s+/);
    const sizeKb = Number(parts[1]);
    const usedKb = Number(parts[2]);
    const availKb = Number(parts[3]);
    const usedPct = Number(String(parts[4] || "").replace("%", ""));
    if (![sizeKb, usedKb, availKb, usedPct].every((n) => Number.isFinite(n))) {
      return null;
    }
    return { sizeKb, usedKb, availKb, usedPct };
  } catch {
    return null;
  }
}

function availBytesFromDf(): number | null {
  const df = parseDataVolumeDf();
  if (!df) return null;
  return df.availKb * 1024;
}

function kill(p: string, acc: { deleted: number; freed: number }) {
  try {
    const sz = fs.statSync(p).size;
    fs.unlinkSync(p);
    acc.deleted += 1;
    acc.freed += sz;
  } catch {
    /* ignore */
  }
}

function isTrashFile(root: string, f: FileEntry): boolean {
  const base = path.basename(f.path);
  const rel = path.relative(root, f.path).replace(/\\/g, "/");
  if (rel.startsWith("backups/")) return false; // pruned separately, never wiped wholesale
  return (
    /\.bak($|-)/i.test(base) ||
    base.endsWith(".importing") ||
    base.endsWith(".tmp") ||
    /\.partial$/i.test(base)
  );
}

function pruneBackupCopies(keep: number, acc: { deleted: number; freed: number }) {
  try {
    const bRoot = backupsRoot();
    if (!fs.existsSync(bRoot)) return;
    const files = fs
      .readdirSync(bRoot)
      .map((f) => {
        const p = path.join(bRoot, f);
        try {
          return { p, t: fs.statSync(p).mtimeMs };
        } catch {
          return null;
        }
      })
      .filter(Boolean) as { p: string; t: number }[];
    files.sort((a, b) => b.t - a.t);
    for (const old of files.slice(Math.max(0, keep))) kill(old.p, acc);
  } catch {
    /* ignore */
  }
}

function needMoreFree(targetFreeBytes: number): boolean {
  const avail = availBytesFromDf();
  if (avail == null) {
    // No df — do not assume the old 420MB budget; skip media deletes.
    return false;
  }
  return avail < targetFreeBytes;
}

/**
 * Reclaim volume space safely for ~10 GB Railway volumes.
 * Never targets a 420MB soft budget (legacy tiny volume).
 * Non-emergency: trash + prune DB backups only — never mass-delete gallery videos.
 */
export function freeGalleryDisk(opts?: {
  emergency?: boolean;
  targetFreeMb?: number;
}): DiskFreeResult {
  const root = dataRoot();
  const gRoot = galleryRoot();
  const before: FileEntry[] = [];
  walkFiles(root, before);
  const beforeBytes = before.reduce((s, f) => s + f.size, 0);
  const acc = { deleted: 0, freed: 0 };
  const emergency = Boolean(opts?.emergency);
  const targetFree =
    (opts?.targetFreeMb ?? TARGET_FREE_MB_DEFAULT) * 1024 * 1024;

  for (const f of before) {
    if (isTrashFile(root, f)) kill(f.path, acc);
  }

  pruneBackupCopies(emergency ? BACKUP_KEEP_EMERGENCY : BACKUP_KEEP_NORMAL, acc);

  // Paid / recent gallery media: only in true ENOSPC, oldest + aged out.
  if (emergency && needMoreFree(targetFree)) {
    const now = Date.now();
    const aged = before
      .filter((f) => f.path.startsWith(gRoot))
      .filter((f) => /\.(mp4|webm|mov|mkv)$/i.test(f.path))
      .filter((f) => !f.path.replace(/\\/g, "/").includes("/tg-catalog/"))
      .filter((f) => f.size >= EMERGENCY_VIDEO_MIN_BYTES)
      .filter((f) => now - f.mtime >= EMERGENCY_VIDEO_MIN_AGE_MS)
      .sort((a, b) => a.mtime - b.mtime);

    for (const f of aged) {
      if (!needMoreFree(targetFree)) break;
      kill(f.path, acc);
    }
  }

  // Last resort under ENOSPC: large catalog video previews only (photos stay).
  if (emergency && needMoreFree(targetFree)) {
    const cat = before
      .filter((f) => f.path.replace(/\\/g, "/").includes("/tg-catalog/"))
      .filter((f) => /\.(mp4|webm|mov|mkv)$/i.test(f.path))
      .filter((f) => f.size >= 800 * 1024)
      .sort((a, b) => a.mtime - b.mtime);
    for (const f of cat) {
      if (!needMoreFree(targetFree)) break;
      kill(f.path, acc);
    }
  }

  const after: FileEntry[] = [];
  walkFiles(root, after);
  return {
    deleted: acc.deleted,
    freed: acc.freed,
    beforeBytes,
    afterBytes: after.reduce((s, f) => s + f.size, 0),
    df: dfSnapshot(),
  };
}

export function getDiskStats(): {
  df: string;
  bytes: number;
  files: number;
  largest: { path: string; mb: number }[];
  categories: { name: string; mb: number; files: number }[];
  volume: ReturnType<typeof parseDataVolumeDf>;
} {
  const root = dataRoot();
  const files: FileEntry[] = [];
  walkFiles(root, files);
  const bytes = files.reduce((s, f) => s + f.size, 0);
  const largest = [...files]
    .sort((a, b) => b.size - a.size)
    .slice(0, 25)
    .map((f) => ({
      path: path.relative(root, f.path).replace(/\\/g, "/"),
      mb: Math.round((f.size / 1024 / 1024) * 10) / 10,
    }));

  const buckets: Record<string, { mb: number; files: number }> = {
    gallery: { mb: 0, files: 0 },
    backups: { mb: 0, files: 0 },
    sqlite: { mb: 0, files: 0 },
    other: { mb: 0, files: 0 },
  };
  for (const f of files) {
    const rel = path.relative(root, f.path).replace(/\\/g, "/");
    const mb = f.size / 1024 / 1024;
    let key: keyof typeof buckets = "other";
    if (rel.startsWith("gallery/") || rel.startsWith("gallery\\")) key = "gallery";
    else if (rel.startsWith("backups/") || rel.startsWith("backups\\")) key = "backups";
    else if (/\.db($|-)/i.test(rel) || /(^|\/)prod\.db/i.test(rel)) key = "sqlite";
    buckets[key].mb += mb;
    buckets[key].files += 1;
  }
  const categories = Object.entries(buckets).map(([name, v]) => ({
    name,
    mb: Math.round(v.mb * 10) / 10,
    files: v.files,
  }));

  return {
    df: dfSnapshot(),
    bytes,
    files: files.length,
    largest,
    categories,
    volume: parseDataVolumeDf(),
  };
}

export function diskAlmostFull(): boolean {
  const df = parseDataVolumeDf();
  if (!df) return false;
  if (df.usedPct >= 92) return true;
  // <40MB free (df -P is 1K-blocks)
  if (df.availKb > 0 && df.availKb < 40 * 1024) return true;
  return false;
}
