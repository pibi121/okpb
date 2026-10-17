/**
 * Refresh infra/release-meta.json from git HEAD before the image is baked.
 * A file left from an older deploy must not win over the commit being built:
 * `railway up` has no Railway git sha, and boot notify reads this file.
 * If git is unavailable (image build without .git), keep the uploaded file.
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

function gitOrEmpty(cmd) {
  try {
    return git(cmd);
  } catch {
    return "";
  }
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

function writeMeta(meta) {
  fs.mkdirSync(path.dirname(META), { recursive: true });
  fs.writeFileSync(META, JSON.stringify(meta, null, 2) + "\n");
}

function main() {
  const existing = readExisting();
  const gitSha = gitOrEmpty("git rev-parse HEAD");
  if (gitSha) {
    const message =
      gitOrEmpty("git log -1 --pretty=%s") || `commit ${gitSha.slice(0, 7)}`;
    const branch = gitOrEmpty("git rev-parse --abbrev-ref HEAD");
    const meta = {
      sha: gitSha,
      message,
      buildVersion:
        process.env.BUILD_VERSION ||
        existing?.buildVersion ||
        "tg-ready-v50-ops-harden",
      branch: branch || undefined,
      at: new Date().toISOString(),
    };
    writeMeta(meta);
    const prev = existing?.sha ? String(existing.sha).slice(0, 7) : "";
    const next = gitSha.slice(0, 7);
    console.log(
      prev && prev !== next
        ? `[release-meta] replaced ${prev} -> ${next}`
        : `[release-meta] wrote from git sha=${next}`,
    );
    return;
  }

  if (existing) {
    console.log(
      `[release-meta] no git, keep ${META} sha=${String(existing.sha).slice(0, 7)}`,
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
    console.warn("[release-meta] no file, no git — deploy notify may skip");
    return;
  }

  writeMeta({
    sha,
    message: message || `commit ${sha.slice(0, 7)}`,
    buildVersion: process.env.BUILD_VERSION || "tg-ready-v50-ops-harden",
    branch: branch || undefined,
    at: new Date().toISOString(),
  });
  console.log(`[release-meta] wrote from env sha=${sha.slice(0, 7)}`);
}

main();
