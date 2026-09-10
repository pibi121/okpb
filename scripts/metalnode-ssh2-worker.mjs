#!/usr/bin/env node
/**
 * CLI worker for Metalnode SSH via ssh2 (no openssh binary required).
 * Invoked by src/lib/metalnode-ssh.ts so Next/Turbopack never bundles ssh2.
 *
 * Usage:
 *   node scripts/metalnode-ssh2-worker.mjs exec <timeoutMs> <remoteCmd>
 *   node scripts/metalnode-ssh2-worker.mjs upload <timeoutMs> <localPath> <remotePath>
 *   node scripts/metalnode-ssh2-worker.mjs upload-dir <timeoutMs> <localDir> <remoteDir>
 *
 * Env: METALNODE_HOST, METALNODE_SSH_PORT, METALNODE_SSH_USER,
 *      METALNODE_SSH_KEY or METALNODE_SSH_KEY_PATH
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { Client } from "ssh2";

const HOST = (process.env.METALNODE_HOST || "").trim();
const PORT = Number(process.env.METALNODE_SSH_PORT || "22026");
const USER = (process.env.METALNODE_SSH_USER || "root").trim();
const KEY_PATH =
  process.env.METALNODE_SSH_KEY_PATH?.trim() || "/tmp/metalnode_ssh_key";

function ensureKey() {
  if (fs.existsSync(KEY_PATH) && fs.statSync(KEY_PATH).size > 32) return KEY_PATH;
  const raw = process.env.METALNODE_SSH_KEY?.trim() || "";
  if (!raw) throw new Error(`no SSH key at ${KEY_PATH} and METALNODE_SSH_KEY empty`);
  const key = raw.includes("\\n") ? raw.replace(/\\n/g, "\n") : raw;
  fs.mkdirSync(path.dirname(KEY_PATH), { recursive: true });
  fs.writeFileSync(KEY_PATH, key.endsWith("\n") ? key : `${key}\n`, { mode: 0o600 });
  return KEY_PATH;
}

function connect(timeoutMs) {
  const privateKey = fs.readFileSync(ensureKey());
  return new Promise((resolve, reject) => {
    const client = new Client();
    let settled = false;
    const t = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        client.end();
      } catch {
        /* ignore */
      }
      reject(new Error(`ssh2 connect timeout ${timeoutMs}ms`));
    }, timeoutMs);
    const fail = (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(t);
      try {
        client.end();
      } catch {
        /* ignore */
      }
      reject(err instanceof Error ? err : new Error(String(err)));
    };
    client
      .on("ready", () => {
        if (settled) return;
        settled = true;
        clearTimeout(t);
        resolve(client);
      })
      .on("error", fail)
      .connect({
        host: HOST,
        port: PORT,
        username: USER,
        privateKey,
        readyTimeout: Math.min(timeoutMs, 60_000),
        keepaliveInterval: 15_000,
        keepaliveCountMax: 4,
      });
  });
}

function exec(client, cmd, timeoutMs, input) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`exec timeout ${timeoutMs}ms`)), timeoutMs);
    client.exec(cmd, (err, stream) => {
      if (err || !stream) {
        clearTimeout(t);
        reject(err || new Error("no stream"));
        return;
      }
      let stdout = "";
      let stderr = "";
      stream.on("data", (d) => {
        stdout += d.toString();
      });
      stream.stderr.on("data", (d) => {
        stderr += d.toString();
      });
      stream.on("close", (code) => {
        clearTimeout(t);
        resolve({ code: code ?? 1, stdout, stderr });
      });
      stream.on("error", (e) => {
        clearTimeout(t);
        reject(e);
      });
      if (input) stream.write(input);
      stream.end();
    });
  });
}

async function cmdExec(timeoutMs, remoteCmd) {
  const client = await connect(Math.min(timeoutMs, 90_000));
  try {
    // Base64 avoids shell -c / quoting breakage for multiline scripts.
    const b64 = Buffer.from(String(remoteCmd), "utf8").toString("base64");
    const wrapped = `echo ${JSON.stringify(b64)} | base64 -d | bash`;
    const r = await exec(client, wrapped, timeoutMs);
    process.stdout.write(r.stdout);
    if (r.stderr) process.stderr.write(r.stderr);
    process.exitCode = r.code;
  } finally {
    client.end();
  }
}

async function cmdUpload(timeoutMs, localPath, remotePath) {
  const client = await connect(Math.min(timeoutMs, 90_000));
  try {
    const remoteDir = remotePath.replace(/\/[^/]+$/, "") || "/";
    await exec(client, `mkdir -p ${JSON.stringify(remoteDir)}`, Math.min(timeoutMs, 60_000));
    await new Promise((resolve, reject) => {
      client.sftp((err, sftp) => {
        if (err || !sftp) {
          reject(err || new Error("no sftp"));
          return;
        }
        const t = setTimeout(() => reject(new Error("sftp timeout")), timeoutMs);
        sftp.fastPut(localPath, remotePath, (e) => {
          clearTimeout(t);
          if (e) reject(e);
          else resolve();
        });
      });
    });
    process.stdout.write("OK\n");
    process.exitCode = 0;
  } finally {
    client.end();
  }
}

async function cmdUploadDir(timeoutMs, localDir, remoteDir) {
  const client = await connect(Math.min(timeoutMs, 90_000));
  try {
    await new Promise((resolve, reject) => {
      const remoteCmd = `mkdir -p ${JSON.stringify(remoteDir)} && tar -xf - -C ${JSON.stringify(remoteDir)}`;
      const t = setTimeout(() => {
        try {
          tar.kill();
        } catch {
          /* ignore */
        }
        reject(new Error(`upload-dir timeout ${timeoutMs}ms`));
      }, timeoutMs);

      let tar;
      client.exec(remoteCmd, (err, stream) => {
        if (err || !stream) {
          clearTimeout(t);
          reject(err || new Error("exec failed"));
          return;
        }
        tar = spawn("tar", ["-cf", "-", "-C", localDir, "."], {
          stdio: ["ignore", "pipe", "pipe"],
        });
        let stderr = "";
        tar.stderr.on("data", (d) => {
          stderr += d.toString();
        });
        stream.stderr.on("data", (d) => {
          stderr += d.toString();
        });
        tar.stdout.pipe(stream);
        let tarCode = null;
        let sshCode = null;
        const done = () => {
          if (tarCode == null || sshCode == null) return;
          clearTimeout(t);
          if (tarCode || sshCode) {
            reject(new Error(`upload-dir failed tar=${tarCode} ssh=${sshCode}: ${stderr.slice(0, 400)}`));
          } else resolve();
        };
        tar.on("error", (e) => {
          clearTimeout(t);
          reject(e);
        });
        stream.on("error", (e) => {
          clearTimeout(t);
          reject(e);
        });
        tar.on("close", (code) => {
          tarCode = code ?? 1;
          try {
            stream.end();
          } catch {
            /* ignore */
          }
          done();
        });
        stream.on("close", (code) => {
          sshCode = code ?? 1;
          done();
        });
      });
    });
    process.stdout.write("OK\n");
    process.exitCode = 0;
  } finally {
    client.end();
  }
}

async function main() {
  if (!HOST) throw new Error("METALNODE_HOST missing");
  const [mode, timeoutRaw, a, b] = process.argv.slice(2);
  const timeoutMs = Math.max(5_000, Number(timeoutRaw) || 120_000);
  if (mode === "exec") {
    if (!a) throw new Error("remote cmd required");
    await cmdExec(timeoutMs, a);
    return;
  }
  if (mode === "exec-b64file") {
    if (!a) throw new Error("b64 file required");
    const b64 = fs.readFileSync(a, "utf8").trim();
    const remoteCmd = Buffer.from(b64, "base64").toString("utf8");
    await cmdExec(timeoutMs, remoteCmd);
    return;
  }
  if (mode === "upload") {
    if (!a || !b) throw new Error("local remote required");
    await cmdUpload(timeoutMs, a, b);
    return;
  }
  if (mode === "upload-dir") {
    if (!a || !b) throw new Error("localDir remoteDir required");
    await cmdUploadDir(timeoutMs, a, b);
    return;
  }
  throw new Error(`unknown mode ${mode}`);
}

main().catch((e) => {
  process.stderr.write(String(e instanceof Error ? e.stack || e.message : e) + "\n");
  process.exit(1);
});
