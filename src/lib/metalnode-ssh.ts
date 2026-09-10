import { spawn, spawnSync } from "node:child_process";
import fs from "fs";
import path from "path";
import { Client, type SFTPWrapper } from "ssh2";
import { loadMetalnodeConfig } from "@/lib/metalnode-config";

const IS_WIN = process.platform === "win32";
const SSH_BIN = IS_WIN ? "ssh.exe" : "ssh";
const TAR_BIN = IS_WIN ? "tar.exe" : "tar";

let openSshCached: boolean | null = null;

function hasOpenSsh(): boolean {
  if (openSshCached != null) return openSshCached;
  try {
    const r = spawnSync(SSH_BIN, ["-V"], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 5000,
    });
    openSshCached = !(r.error && (r.error as NodeJS.ErrnoException).code === "ENOENT");
  } catch {
    openSshCached = false;
  }
  return openSshCached;
}

/** Materialize METALNODE_SSH_KEY onto disk (Railway has no openssh key file by default). */
export function ensureMetalnodeKeyFile(): string {
  const cfg = loadMetalnodeConfig();
  const preferred =
    process.env.METALNODE_SSH_KEY_PATH?.trim() ||
    cfg.sshKeyPath ||
    "/tmp/metalnode_ssh_key";

  if (fs.existsSync(preferred) && fs.statSync(preferred).size > 32) {
    return preferred;
  }

  const raw = process.env.METALNODE_SSH_KEY?.trim() || "";
  if (!raw) {
    if (fs.existsSync(cfg.sshKeyPath)) return cfg.sshKeyPath;
    throw new Error(
      `SSH key not found (${preferred}). Set METALNODE_SSH_KEY or METALNODE_SSH_KEY_PATH.`,
    );
  }
  const key = raw.includes("\\n") ? raw.replace(/\\n/g, "\n") : raw;
  fs.mkdirSync(path.dirname(preferred), { recursive: true });
  fs.writeFileSync(preferred, key.endsWith("\n") ? key : `${key}\n`, {
    mode: 0o600,
  });
  process.env.METALNODE_SSH_KEY_PATH = preferred;
  return preferred;
}

function sshBaseArgs(extra: string[] = []) {
  const cfg = loadMetalnodeConfig();
  const keyPath = ensureMetalnodeKeyFile();
  if (!fs.existsSync(keyPath)) {
    throw new Error(`SSH key not found: ${keyPath}`);
  }
  // ControlMaster is unreliable on Windows OpenSSH — skip it there.
  const mux: string[] = IS_WIN
    ? []
    : [
        "-o",
        "ControlMaster=auto",
        "-o",
        `ControlPath=/tmp/peach-ssh-${cfg.host}-${cfg.sshPort}`,
        "-o",
        "ControlPersist=600",
      ];
  return {
    cfg: { ...cfg, sshKeyPath: keyPath },
    args: [
      "-i",
      keyPath,
      "-p",
      String(cfg.sshPort),
      "-o",
      "BatchMode=yes",
      "-o",
      "StrictHostKeyChecking=accept-new",
      "-o",
      "ConnectTimeout=60",
      "-o",
      "ServerAliveInterval=15",
      "-o",
      "ServerAliveCountMax=4",
      "-o",
      "TCPKeepAlive=yes",
      ...mux,
      ...extra,
    ] as string[],
    target: `${cfg.sshUser}@${cfg.host}`,
  };
}

function run(
  cmd: string,
  args: string[],
  timeoutMs = 120_000,
  opts?: { input?: Buffer },
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      windowsHide: true,
      env: process.env,
    });
    let stdout = "";
    let stderr = "";
    const t = setTimeout(() => {
      child.kill();
      reject(new Error(`${cmd} timeout after ${Math.round(timeoutMs / 1000)}s`));
    }, timeoutMs);
    child.stdout.on("data", (d) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("error", (e) => {
      clearTimeout(t);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(t);
      resolve({ code: code ?? 1, stdout, stderr });
    });
    if (opts?.input) {
      child.stdin.write(opts.input);
      child.stdin.end();
    } else {
      child.stdin.end();
    }
  });
}

async function withRetry<T>(fn: () => Promise<T>, attempts = 10, label = "ssh"): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[peach] ${label} attempt ${i + 1}/${attempts} failed:`, msg.slice(0, 240));
      if (i < attempts - 1) {
        const reset = /reset|timed out|timeout|refused|banner exchange|ENOENT|handshake/i.test(
          msg,
        );
        await new Promise((r) => setTimeout(r, reset ? 4000 * (i + 1) : 2000 * (i + 1)));
      }
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
}

type Ssh2Conn = {
  client: Client;
  end: () => void;
};

async function connectSsh2(timeoutMs = 60_000): Promise<Ssh2Conn> {
  const cfg = loadMetalnodeConfig();
  const keyPath = ensureMetalnodeKeyFile();
  const privateKey = fs.readFileSync(keyPath);

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
      reject(new Error(`ssh2 connect timeout after ${Math.round(timeoutMs / 1000)}s`));
    }, timeoutMs);

    const fail = (err: unknown) => {
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
        resolve({
          client,
          end: () => {
            try {
              client.end();
            } catch {
              /* ignore */
            }
          },
        });
      })
      .on("error", fail)
      .connect({
        host: cfg.host,
        port: cfg.sshPort,
        username: cfg.sshUser,
        privateKey,
        readyTimeout: Math.min(timeoutMs, 60_000),
        keepaliveInterval: 15_000,
        keepaliveCountMax: 4,
      });
  });
}

async function ssh2Exec(
  remoteCmd: string,
  timeoutMs: number,
  opts?: { input?: Buffer },
): Promise<{ code: number; stdout: string; stderr: string }> {
  const conn = await connectSsh2(Math.min(timeoutMs, 90_000));
  try {
    return await new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        conn.end();
        reject(new Error(`ssh2 exec timeout after ${Math.round(timeoutMs / 1000)}s`));
      }, timeoutMs);

      conn.client.exec(remoteCmd, (err, stream) => {
        if (err || !stream) {
          clearTimeout(t);
          reject(err || new Error("ssh2 exec: no stream"));
          return;
        }
        let stdout = "";
        let stderr = "";
        stream.on("data", (d: Buffer) => {
          stdout += d.toString();
        });
        stream.stderr.on("data", (d: Buffer) => {
          stderr += d.toString();
        });
        stream.on("close", (code: number | null) => {
          clearTimeout(t);
          resolve({ code: code ?? 1, stdout, stderr });
        });
        stream.on("error", (e: Error) => {
          clearTimeout(t);
          reject(e);
        });
        if (opts?.input) {
          stream.write(opts.input);
        }
        stream.end();
      });
    });
  } finally {
    conn.end();
  }
}

async function ssh2SftpPut(localPath: string, remotePath: string, timeoutMs: number) {
  const conn = await connectSsh2(Math.min(timeoutMs, 90_000));
  try {
    const remoteDir = remotePath.replace(/\/[^/]+$/, "") || "/";
    await new Promise<void>((resolve, reject) => {
      conn.client.exec(`mkdir -p ${JSON.stringify(remoteDir)}`, (err, stream) => {
        if (err || !stream) {
          reject(err || new Error("mkdir failed"));
          return;
        }
        stream.on("close", () => resolve());
        stream.resume();
      });
    });
    const sftp: SFTPWrapper = await new Promise((resolve, reject) => {
      conn.client.sftp((err, s) => {
        if (err || !s) reject(err || new Error("no sftp"));
        else resolve(s);
      });
    });
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("sftp put timeout")), timeoutMs);
      sftp.fastPut(localPath, remotePath, (err) => {
        clearTimeout(t);
        if (err) reject(err);
        else resolve();
      });
    });
  } finally {
    conn.end();
  }
}

async function ssh2UploadDirTar(localDir: string, remoteDir: string, timeoutMs: number) {
  const conn = await connectSsh2(Math.min(timeoutMs, 90_000));
  let tarProc: ReturnType<typeof spawn> | null = null;
  try {
    await new Promise<void>((resolve, reject) => {
      const remoteCmd = `mkdir -p ${JSON.stringify(remoteDir)} && tar -xf - -C ${JSON.stringify(remoteDir)}`;
      const t = setTimeout(() => {
        try {
          tarProc?.kill();
        } catch {
          /* ignore */
        }
        conn.end();
        reject(new Error(`ssh2 tar upload timeout after ${Math.round(timeoutMs / 1000)}s`));
      }, timeoutMs);

      conn.client.exec(remoteCmd, (err, stream) => {
        if (err || !stream) {
          clearTimeout(t);
          reject(err || new Error("ssh2 tar exec failed"));
          return;
        }

        tarProc = spawn(TAR_BIN, ["-cf", "-", "-C", localDir, "."], {
          windowsHide: true,
          stdio: ["ignore", "pipe", "pipe"],
        });
        const tar = tarProc;

        let stderr = "";
        tar.stderr.on("data", (d) => {
          stderr += `tar: ${d.toString()}`;
        });
        stream.stderr.on("data", (d: Buffer) => {
          stderr += d.toString();
        });

        tar.on("error", (e) => {
          clearTimeout(t);
          reject(e);
        });
        stream.on("error", (e: Error) => {
          clearTimeout(t);
          reject(e);
        });

        tar.stdout.pipe(stream);

        let tarCode: number | null = null;
        let sshCode: number | null = null;
        const maybeDone = () => {
          if (tarCode == null || sshCode == null) return;
          clearTimeout(t);
          if (sshCode || tarCode) {
            reject(
              new Error(
                `dataset upload failed (ssh=${sshCode} tar=${tarCode}): ${stderr.slice(0, 600)}`,
              ),
            );
          } else {
            resolve();
          }
        };

        tar.on("close", (code) => {
          tarCode = code ?? 1;
          try {
            stream.end();
          } catch {
            /* ignore */
          }
          maybeDone();
        });
        stream.on("close", (code: number | null) => {
          sshCode = code ?? 1;
          maybeDone();
        });
      });
    });
  } finally {
    conn.end();
  }
}

async function openSshExec(
  remoteCmd: string,
  timeoutMs: number,
  opts?: { input?: Buffer },
) {
  const { args, target } = sshBaseArgs();
  return run(SSH_BIN, [...args, target, remoteCmd], timeoutMs, opts);
}

export async function metalnodeSsh(remoteCmd: string, timeoutMs = 180_000) {
  return withRetry(
    async () => {
      if (hasOpenSsh()) {
        try {
          const r = await openSshExec(remoteCmd, timeoutMs);
          if (r.code !== 0) {
            throw new Error(`ssh failed (${r.code}): ${(r.stderr || r.stdout).slice(0, 500)}`);
          }
          return r.stdout;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (!/ENOENT|spawn/i.test(msg)) throw e;
          openSshCached = false;
          console.warn("[peach] openssh missing — falling back to ssh2");
        }
      }
      const r = await ssh2Exec(remoteCmd, timeoutMs);
      if (r.code !== 0) {
        throw new Error(`ssh2 failed (${r.code}): ${(r.stderr || r.stdout).slice(0, 500)}`);
      }
      return r.stdout;
    },
    5,
    "ssh",
  );
}

/** Upload one file via ssh stdin / sftp (no scp.exe). */
export async function metalnodeScpTo(localPath: string, remotePath: string, timeoutMs = 300_000) {
  return withRetry(
    async () => {
      if (hasOpenSsh()) {
        try {
          const bytes = fs.readFileSync(localPath);
          const remoteDir = remotePath.replace(/\/[^/]+$/, "");
          const cmd = `mkdir -p ${JSON.stringify(remoteDir)} && cat > ${JSON.stringify(remotePath)}`;
          const r = await openSshExec(cmd, timeoutMs, { input: bytes });
          if (r.code !== 0) {
            throw new Error(`upload failed (${r.code}): ${(r.stderr || r.stdout).slice(0, 500)}`);
          }
          return;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (!/ENOENT|spawn/i.test(msg)) throw e;
          openSshCached = false;
        }
      }
      await ssh2SftpPut(localPath, remotePath, timeoutMs);
    },
    4,
    "upload-file",
  );
}

/** Upload directory as one tar stream over a single SSH connection. */
export async function metalnodeScpDirTo(localDir: string, remoteDir: string, timeoutMs = 900_000) {
  const files = fs.readdirSync(localDir);
  if (!files.length) throw new Error("local dataset empty");

  await metalnodeSsh(`mkdir -p ${JSON.stringify(remoteDir)}`, 90_000);

  return withRetry(
    async () => {
      if (hasOpenSsh()) {
        try {
          const { args, target } = sshBaseArgs();
          const remoteCmd = `mkdir -p ${JSON.stringify(remoteDir)} && tar -xf - -C ${JSON.stringify(remoteDir)}`;
          const r = await new Promise<{ code: number; stdout: string; stderr: string }>(
            (resolve, reject) => {
              const ssh = spawn(SSH_BIN, [...args, target, remoteCmd], {
                windowsHide: true,
                stdio: ["pipe", "pipe", "pipe"],
                env: process.env,
              });
              const tar = spawn(TAR_BIN, ["-cf", "-", "-C", localDir, "."], {
                windowsHide: true,
                stdio: ["ignore", "pipe", "pipe"],
              });

              let stdout = "";
              let stderr = "";
              const t = setTimeout(() => {
                tar.kill();
                ssh.kill();
                reject(new Error(`tar|ssh timeout after ${Math.round(timeoutMs / 1000)}s`));
              }, timeoutMs);

              tar.stdout.pipe(ssh.stdin);
              tar.stderr.on("data", (d) => {
                stderr += `tar: ${d.toString()}`;
              });
              ssh.stdout.on("data", (d) => {
                stdout += d.toString();
              });
              ssh.stderr.on("data", (d) => {
                stderr += d.toString();
              });

              let tarCode: number | null = null;
              let sshCode: number | null = null;
              const maybeDone = () => {
                if (tarCode == null || sshCode == null) return;
                clearTimeout(t);
                resolve({ code: sshCode || tarCode || 0, stdout, stderr });
              };
              tar.on("error", (e) => {
                clearTimeout(t);
                reject(e);
              });
              ssh.on("error", (e) => {
                clearTimeout(t);
                reject(e);
              });
              tar.on("close", (code) => {
                tarCode = code ?? 1;
                try {
                  ssh.stdin.end();
                } catch {
                  /* ignore */
                }
                maybeDone();
              });
              ssh.on("close", (code) => {
                sshCode = code ?? 1;
                maybeDone();
              });
            },
          );

          if (r.code !== 0) {
            throw new Error(
              `dataset upload failed (${r.code}): ${(r.stderr || r.stdout).slice(0, 600)}`,
            );
          }
          return;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (!/ENOENT|spawn/i.test(msg)) throw e;
          openSshCached = false;
          console.warn("[peach] openssh missing for upload — falling back to ssh2");
        }
      }
      await ssh2UploadDirTar(localDir, remoteDir, timeoutMs);
    },
    3,
    "upload-dir",
  );
}

export async function metalnodeCheck(): Promise<{ ok: boolean; detail: string }> {
  try {
    ensureMetalnodeKeyFile();
    const out = await metalnodeSsh("echo PONG", 75_000);
    if (out.includes("PONG")) return { ok: true, detail: hasOpenSsh() ? "openssh" : "ssh2" };
    return { ok: false, detail: `unexpected: ${out.slice(0, 200)}` };
  } catch (e) {
    return {
      ok: false,
      detail: e instanceof Error ? e.message : String(e),
    };
  }
}
