import path from "path";
import fs from "fs";

export function dataRoot() {
  return path.join(process.cwd(), "data");
}

export function galleryRoot() {
  return path.join(dataRoot(), "gallery");
}

export function backupsRoot() {
  return path.join(dataRoot(), "backups");
}

export function ensureDataDirs() {
  for (const p of [dataRoot(), galleryRoot(), backupsRoot(), path.join(dataRoot(), "characters")]) {
    fs.mkdirSync(p, { recursive: true });
  }
}

/** Resolve SQLite path used by Prisma. */
export function resolveSqlitePath() {
  const candidates = [
    path.join(process.cwd(), "prisma", "dev.db"),
    path.join(process.cwd(), "dev.db"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return candidates[0];
}
