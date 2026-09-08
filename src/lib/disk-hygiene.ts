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

function walkFiles(dir: string, out: { path: string; size: number; mtime: number }[], depth = 0) {
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

function kill(
  p: string,
  acc: { deleted: number; freed: number },
) {
  try {
    const sz = fs.statSync(p).size;
    fs.unlinkSync(p);
    acc.deleted += 1;
    acc.freed += sz;
  } catch {
    /* ignore */
  }
}

/** Reclaim volume space. Keeps tg-catalog previews unless emergency. */
export function freeGalleryDisk(opts?: {
  emergency?: boolean;
  targetFreeMb?: number;
}): DiskFreeResult {
  const root = dataRoot();
  const gRoot = galleryRoot();
  const before: { path: string; size: number; mtime: number }[] = [];
  walkFiles(root, before);
  const beforeBytes = before.reduce((s, f) => s + f.size, 0);
  const acc = { deleted: 0, freed: 0 };
  const emergency = Boolean(opts?.emergency);
  const targetFree = (opts?.targetFreeMb ?? 80) * 1024 * 1024;

  for (const f of before) {
    const base = path.basename(f.path);
    const rel = path.relative(root, f.path).replace(/\\/g, "/");
    if (
      /\.bak($|-)/i.test(base) ||
      base.endsWith(".importing") ||
      base.endsWith(".tmp") ||
      /\.partial$/i.test(base) ||
      rel.startsWith("backups/")
    ) {
      kill(f.path, acc);
    }
  }

  // Drop oversized user videos first (keep catalog).
  const videos = before
    .filter((f) => f.path.startsWith(gRoot))
    .filter((f) => /\.(mp4|webm|mov|mkv)$/i.test(f.path))
    .filter((f) => !f.path.replace(/\\/g, "/").includes("/tg-catalog/"))
    .sort((a, b) => b.size - a.size || a.mtime - b.mtime);

  for (const f of videos) {
    if (f.size >= 25 * 1024 * 1024) kill(f.path, acc);
  }

  // If still tight, delete oldest user videos > 1.5MB until target.
  const afterPass1: { path: string; size: number; mtime: number }[] = [];
  walkFiles(root, afterPass1);
  let used = afterPass1.reduce((s, f) => s + f.size, 0);
  const volumeBudget = 420 * 1024 * 1024; // soft budget for ~434MB volume
  if (used > volumeBudget - targetFree || emergency) {
    const rest = afterPass1
      .filter((f) => f.path.startsWith(gRoot))
      .filter((f) => /\.(mp4|webm|mov|mkv)$/i.test(f.path))
      .filter((f) => !f.path.replace(/\\/g, "/").includes("/tg-catalog/"))
      .filter((f) => f.size >= 1.5 * 1024 * 1024)
      .sort((a, b) => a.mtime - b.mtime);
    for (const f of rest) {
      if (used <= volumeBudget - targetFree && !emergency) break;
      kill(f.path, acc);
      used -= f.size;
    }
  }

  if (emergency) {
    // Last resort: catalog video previews too (photos stay).
    const cat = afterPass1
      .filter((f) => f.path.replace(/\\/g, "/").includes("/tg-catalog/"))
      .filter((f) => /\.(mp4|webm|mov|mkv)$/i.test(f.path))
      .filter((f) => f.size >= 800 * 1024)
      .sort((a, b) => b.size - a.size);
    for (const f of cat) {
      if (used <= volumeBudget - targetFree) break;
      kill(f.path, acc);
      used -= f.size;
    }
  }

  // Cap sqlite backups folder
  try {
    const bRoot = backupsRoot();
    if (fs.existsSync(bRoot)) {
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
      for (const old of files.slice(5)) kill(old.p, acc);
    }
  } catch {
    /* ignore */
  }

  const after: { path: string; size: number; mtime: number }[] = [];
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
} {
  const root = dataRoot();
  const files: { path: string; size: number; mtime: number }[] = [];
  walkFiles(root, files);
  const bytes = files.reduce((s, f) => s + f.size, 0);
  const largest = [...files]
    .sort((a, b) => b.size - a.size)
    .slice(0, 25)
    .map((f) => ({
      path: path.relative(root, f.path).replace(/\\/g, "/"),
      mb: Math.round((f.size / 1024 / 1024) * 10) / 10,
    }));
  return { df: dfSnapshot(), bytes, files: files.length, largest };
}

export function diskAlmostFull(): boolean {
  try {
    const { execSync } = require("node:child_process") as typeof import("node:child_process");
    const out = execSync("df -P /app/data 2>/dev/null || df -P .", {
      encoding: "utf8",
      timeout: 4000,
    });
    const line = out.trim().split(/\r?\n/).pop() || "";
    const parts = line.split(/\s+/);
    // Filesystem 1024-blocks Used Available Capacity Mounted
    const avail = Number(parts[3]);
    const capacity = String(parts[4] || "");
    if (capacity.endsWith("%") && Number(capacity.replace("%", "")) >= 92) return true;
    if (Number.isFinite(avail) && avail > 0 && avail < 40 * 1024) return true; // <40MB in 1K blocks
  } catch {
    /* ignore */
  }
  return false;
}
