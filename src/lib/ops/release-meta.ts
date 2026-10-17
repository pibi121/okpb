/**
 * Resolve release metadata for ops deploy/commit notifications.
 * Priority: env → infra/release-meta.json → BUILD_VERSION only.
 */
import fs from "fs";
import path from "path";
import { BUILD_VERSION } from "@/lib/gpu/types";

export type ReleaseMeta = {
  sha: string;
  message: string;
  buildVersion: string;
  branch?: string;
  at?: string;
};

const META_PATHS = [
  path.join(process.cwd(), "infra", "release-meta.json"),
  path.join(process.cwd(), "release-meta.json"),
];

function readMetaFile(): Partial<ReleaseMeta> | null {
  for (const p of META_PATHS) {
    try {
      if (!fs.existsSync(p)) continue;
      const v = JSON.parse(fs.readFileSync(p, "utf8")) as Partial<ReleaseMeta>;
      if (v && typeof v === "object") return v;
    } catch {
      /* ignore */
    }
  }
  return null;
}

export function resolveReleaseMeta(): ReleaseMeta {
  const file = readMetaFile();
  const envSha = (
    process.env.RAILWAY_GIT_COMMIT_SHA?.trim() ||
    process.env.GIT_COMMIT_SHA?.trim() ||
    process.env.COMMIT_SHA?.trim() ||
    ""
  ).trim();
  const fileSha = (file?.sha || "").trim();
  const sha = (envSha || fileSha).trim();
  // A leftover release-meta.json must not supply the subject of a different commit.
  const fileMatches = !envSha || !fileSha || envSha === fileSha;
  const message = (
    process.env.RAILWAY_GIT_COMMIT_MESSAGE?.trim() ||
    process.env.GIT_COMMIT_MESSAGE?.trim() ||
    (fileMatches ? file?.message : "") ||
    ""
  )
    .trim()
    .slice(0, 500);
  const branch = (
    process.env.RAILWAY_GIT_BRANCH?.trim() ||
    process.env.GIT_BRANCH?.trim() ||
    (fileMatches ? file?.branch : "") ||
    ""
  ).trim();
  return {
    sha,
    message: message || (sha ? `commit ${sha.slice(0, 7)}` : "—"),
    buildVersion: file?.buildVersion || BUILD_VERSION,
    branch: branch || undefined,
    at: file?.at,
  };
}

/** Write meta before `railway up` so prod boot has the commit subject. */
export function writeReleaseMetaFile(meta: ReleaseMeta): string {
  const p = path.join(process.cwd(), "infra", "release-meta.json");
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(meta, null, 2) + "\n", "utf8");
  return p;
}
