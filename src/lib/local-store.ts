import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import {
  backupsRoot,
  ensureDataDirs,
  galleryRoot,
  resolveSqlitePath,
} from "./paths";

export function saveGalleryBinary(
  userId: string,
  ext: string,
  bytes: Buffer,
  prefix = "still",
): { absPath: string; publicUrl: string; relKey: string } {
  ensureDataDirs();
  const dir = path.join(galleryRoot(), userId);
  fs.mkdirSync(dir, { recursive: true });
  const name = `${prefix}_${Date.now()}_${randomUUID().slice(0, 8)}.${ext.replace(/^\./, "")}`;
  const absPath = path.join(dir, name);
  fs.writeFileSync(absPath, bytes);
  const relKey = `${userId}/${name}`;
  return { absPath, publicUrl: `/api/media/${relKey}`, relKey };
}

export function localPathFromResultUrl(resultUrl: string): string | null {
  if (!resultUrl.startsWith("/api/media/")) return null;
  const key = resultUrl.replace(/^\/api\/media\//, "").split("?")[0] || "";
  return resolveGalleryFile(key);
}

export function resolveGalleryFile(relKey: string): string | null {
  const safe = relKey.replace(/\\/g, "/").replace(/\.\./g, "");
  const abs = path.join(galleryRoot(), ...safe.split("/"));
  if (!abs.startsWith(galleryRoot())) return null;
  return fs.existsSync(abs) ? abs : null;
}

/** Copy SQLite DB into data/backups. Safe to call often. */
export function backupDatabase(reason = "auto"): string | null {
  try {
    ensureDataDirs();
    const src = resolveSqlitePath();
    if (!fs.existsSync(src)) return null;
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const dest = path.join(backupsRoot(), `dev-${stamp}-${reason}.db`);
    fs.copyFileSync(src, dest);
    // keep last 30 backups
    const files = fs
      .readdirSync(backupsRoot())
      .filter((f) => f.startsWith("dev-") && f.endsWith(".db"))
      .map((f) => ({ f, t: fs.statSync(path.join(backupsRoot(), f)).mtimeMs }))
      .sort((a, b) => b.t - a.t);
    for (const old of files.slice(30)) {
      fs.unlinkSync(path.join(backupsRoot(), old.f));
    }
    return dest;
  } catch {
    return null;
  }
}
