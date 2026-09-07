/**
 * Detached Paramiko Comfy tunnel (:8188). Windows OpenSSH -L is unreliable.
 *   node scripts/start-comfy-tunnel-detached.mjs
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const script = path.join(ROOT, "scripts", "paramiko-comfy-tunnel.py");
const logDir = path.join(ROOT, "data", "logs");
fs.mkdirSync(logDir, { recursive: true });
const outPath = path.join(logDir, "paramiko-comfy-tunnel.log");
const out = fs.openSync(outPath, "a");
const pidPath = path.join(logDir, "tunnel.pid");

function ping() {
  return new Promise((resolve) => {
    const req = http.get(
      "http://127.0.0.1:8188/system_stats",
      { timeout: 4000 },
      (res) => {
        res.resume();
        resolve(res.statusCode >= 200 && res.statusCode < 500);
      },
    );
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
}

if (await ping()) {
  console.log("COMFY_OK already");
  process.exit(0);
}

const child = spawn("python", [script], {
  cwd: ROOT,
  detached: true,
  stdio: ["ignore", out, out],
  windowsHide: true,
});
child.unref();
fs.writeFileSync(pidPath, String(child.pid));
console.log("spawned", child.pid, "log", outPath);

for (let i = 0; i < 25; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  if (await ping()) {
    console.log("COMFY_OK");
    process.exit(0);
  }
}
console.log("COMFY_FAIL");
try {
  console.log(fs.readFileSync(outPath, "utf8").slice(-800));
} catch {
  /* ignore */
}
process.exit(1);
