/**
 * Ensure persistent Railway volume dirs exist before Prisma / gallery writes.
 * Also log age-gate python availability (non-fatal).
 */
import { spawnSync } from "node:child_process";
import fs from "fs";
import { ensureDataDirs } from "../src/lib/paths";

ensureDataDirs();
console.log("[railway] data dirs OK:", process.env.DATABASE_URL || "(default)");

const pyCandidates = [
  process.env.AGE_GATE_PYTHON,
  "/mise/shims/python",
  "/mise/shims/python3",
  "/opt/venv/bin/python",
  "/opt/venv/bin/python3",
  "python3",
  "python3.12",
  "python",
].filter(Boolean) as string[];

let found: string | null = null;
for (const bin of pyCandidates) {
  try {
    if (bin.includes("/") && !fs.existsSync(bin)) continue;
    const r = spawnSync(bin, ["-V"], { encoding: "utf8", timeout: 8000 });
    if (!r.error && r.status === 0) {
      found = `${bin} ${(r.stdout || r.stderr || "").trim()}`;
      break;
    }
  } catch {
    /* next */
  }
}
console.log("[railway] age-gate python:", found || "NOT FOUND");
if (found) {
  const bin = found.split(" ")[0]!;
  const probe = spawnSync(bin, ["-c", "import cv2,numpy; print('cv2', cv2.__version__)"], {
    encoding: "utf8",
    timeout: 30_000,
  });
  console.log(
    "[railway] age-gate opencv:",
    (probe.stdout || "").trim() || (probe.stderr || "").slice(0, 200) || `exit ${probe.status}`,
  );
}
