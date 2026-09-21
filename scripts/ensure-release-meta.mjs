/**
 * Ensure infra/release-meta.json exists before next build / image bake.
 * Prefer file written by ops-notify-release.mjs; else git HEAD (local / CI).
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const META = path.join(ROOT, "infra", "release-meta.json");

function git(cmd) {
  return execSync(cmd, { cwd: ROOT, encoding: "utf8" }).trim();
}

function readExisting() {
  try {
    if (!fs.existsSync(META)) return null;
    const v = JSON.parse(fs.readFileSync(META, "utf8"));
    if (v?.sha && String(v.sha).trim()) return v;
  } catch {
    /* ignore */
  }
  return null;
}

function main() {
  const existing = readExisting();
  if (existing) {
    console.log(
      `[release-meta] keep ${META} sha=${String(existing.sha).slice(0, 7)}`,
    );
    return;
  }

  let sha = (
    process.env.RAILWAY_GIT_COMMIT_SHA ||
    process.env.GIT_COMMIT_SHA ||
    process.env.COMMIT_SHA ||
    ""
  ).trim();
  let message = (
    process.env.RAILWAY_GIT_COMMIT_MESSAGE ||
    process.env.GIT_COMMIT_MESSAGE ||
    ""
  ).trim();
  let branch = (
    process.env.RAILWAY_GIT_BRANCH ||
    process.env.GIT_BRANCH ||
    ""
  ).trim();

  if (!sha) {
    try {
      sha = git("git rev-parse HEAD");
      message = message || git("git log -1 --pretty=%s");
      branch = branch || git("git rev-parse --abbrev-ref HEAD");
    } catch {
      console.warn(
        "[release-meta] no existing file, no git — deploy notify may skip",
      );
      return;
    }
  }

  const meta = {
    sha,
    message: message || `commit ${sha.slice(0, 7)}`,
    buildVersion: process.env.BUILD_VERSION || "tg-ready-v50-ops-harden",
    branch: branch || undefined,
    at: new Date().toISOString(),
  };
  fs.mkdirSync(path.dirname(META), { recursive: true });
  fs.writeFileSync(META, JSON.stringify(meta, null, 2) + "\n");
  console.log(`[release-meta] wrote ${META} sha=${sha.slice(0, 7)}`);
}

main();
