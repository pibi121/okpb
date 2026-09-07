import fs from "node:fs";
import path from "node:path";

const IMG = /\.(png|jpe?g|webp|gif)$/i;

export function listDefaultAvatarUrls(): string[] {
  const dir = path.join(process.cwd(), "public", "avatars", "default");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => IMG.test(f))
    .sort()
    .map((f) => `/avatars/default/${f}`);
}

export function pickRandomAvatarUrl(seed?: string): string {
  const all = listDefaultAvatarUrls();
  if (!all.length) return "";
  if (seed) {
    let h = 0;
    for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
    return all[Math.abs(h) % all.length]!;
  }
  return all[Math.floor(Math.random() * all.length)]!;
}
