/**
 * Dev entry: sync Prisma schema/client, then start Next.js.
 * Avoids stale PrismaClient delegates after schema changes.
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const isWin = process.platform === "win32";
const npm = isWin ? "npm.cmd" : "npm";

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    cwd: ROOT,
    stdio: "inherit",
    windowsHide: true,
    shell: isWin,
    ...opts,
  });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

console.log("[dev] prisma db push…");
run("npx", ["prisma", "db", "push", "--skip-generate"]);

console.log("[dev] prisma generate…");
run("npx", ["prisma", "generate"]);

const nextArgs = ["dev", ...process.argv.slice(2)];
const nextBin = path.join(ROOT, "node_modules", "next", "dist", "bin", "next");
const useNextBin = fs.existsSync(nextBin);

console.log("[dev] starting Next.js…");
const child = spawn(
  useNextBin ? process.execPath : npm,
  useNextBin ? [nextBin, ...nextArgs] : ["run", "dev:next", ...nextArgs],
  { cwd: ROOT, stdio: "inherit", windowsHide: true, env: process.env },
);

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 0);
});

process.on("SIGINT", () => child.kill("SIGINT"));
process.on("SIGTERM", () => child.kill("SIGTERM"));
