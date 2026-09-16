import { spawn, spawnSync } from "node:child_process";
import { AsyncLocalStorage } from "node:async_hooks";
import fs from "fs";
import path from "path";
import { loadMetalnodeConfig, type MetalnodeConfig } from "@/lib/metalnode-config";

const IS_WIN = process.platform === "win32";
const SSH_BIN = IS_WIN ? "ssh.exe" : "ssh";
const TAR_BIN = IS_WIN ? "tar.exe" : "tar";
const WORKER = path.join(process.cwd(), "scripts", "metalnode-ssh2-worker.mjs");

type SshTargetOverride = Partial<
  Pick<MetalnodeConfig, "host" | "sshPort" | "sshUser" | "sshKeyPath">
> & { sshKeyEnv?: string };

const sshTargetAls = new AsyncLocalStorage<SshTargetOverride>();

/** Run Metalnode SSH/SCP against a specific fleet card (e.g. bmserv1 for LoRA). */
export function withMetalnodeSshTarget<T>(
  override: SshTargetOverride,
  fn: () => Promise<T>,
): Promise<T> {
  return sshTargetAls.run(override, fn);
}

function activeMetalnodeConfig(): MetalnodeConfig {
  const base = loadMetalnodeConfig();
  const o = sshTargetAls.getStore();
  if (!o) return base;
  return {
    ...base,
    host: o.host || base.host,
    sshPort: o.sshPort && o.sshPort > 0 ? o.sshPort : base.sshPort,
    sshUser: o.sshUser || base.sshUser,
    sshKeyPath: o.sshKeyPath || base.sshKeyPath,
  };
}

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
  const cfg = activeMetalnodeConfig();
  const override = sshTargetAls.getStore();
  const preferred =
    override?.sshKeyPath?.trim() ||
    process.env.METALNODE_SSH_KEY_PATH?.trim() ||
    cfg.sshKeyPath ||
    "/tmp/metalnode_ssh_key";

  if (fs.existsSync(preferred) && fs.statSync(preferred).size > 32) {
    return preferred;
  }

  const rawFromEnv =
    (override?.sshKeyEnv && process.env[override.sshKeyEnv]?.trim()) ||
    process.env.METALNODE_SSH_KEY?.trim() ||
    "";
  const raw = rawFromEnv;
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
  if (!override) {
    process.env.METALNODE_SSH_KEY_PATH = preferred;
  }
  return preferred;
}

function sshBaseArgs(extra: string[] = []) {
  const cfg = activeMetalnodeConfig();
  const keyPath = ensureMetalnodeKeyFile();
  if (!fs.existsSync(keyPath)) {
    throw new Error(`SSH key not found: ${keyPath}`);
  }
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
  opts?: { input?: Buffer; env?: NodeJS.ProcessEnv },
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      windowsHide: true,
      env: { ...process.env, ...opts?.env },
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
        const reset = /reset|timed out|timeout|stall|refused|banner exchange|ENOENT|handshake|ECONN/i.test(
          msg,
        );
        await new Promise((r) => setTimeout(r, reset ? 4000 * (i + 1) : 2000 * (i + 1)));
      }
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
}

function workerEnv(): NodeJS.ProcessEnv {
  const cfg = activeMetalnodeConfig();
  const keyPath = ensureMetalnodeKeyFile();
  return {
    ...process.env,
    METALNODE_HOST: cfg.host,
    METALNODE_SSH_PORT: String(cfg.sshPort),
    METALNODE_SSH_USER: cfg.sshUser,
    METALNODE_SSH_KEY_PATH: keyPath,
  };
}

/** Run ssh2 via external Node worker (avoids Next/Turbopack bundling native ssh2). */
async function ssh2Worker(
  mode: "exec" | "upload" | "upload-dir",
  timeoutMs: number,
  a: string,
  b?: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  if (!fs.existsSync(WORKER)) {
    throw new Error(`ssh2 worker missing: ${WORKER}`);
  }
  // Multiline / special-char remote scripts: pass via base64 file to avoid argv/-c breakage.
  if (mode === "exec") {
    const b64 = Buffer.from(a, "utf8").toString("base64");
    const tmp = path.join(
      process.env.TEMP || process.env.TMPDIR || "/tmp",
      `peach-ssh2-cmd-${Date.now()}-${Math.random().toString(36).slice(2)}.b64`,
    );
    fs.writeFileSync(tmp, b64, "utf8");
    try {
      const r = await run(
        process.execPath,
        [WORKER, "exec-b64file", String(timeoutMs), tmp],
        timeoutMs + 30_000,
        { env: workerEnv() },
      );
      return r;
    } finally {
      try {
        fs.unlinkSync(tmp);
      } catch {
        /* ignore */
      }
    }
  }
  const args = [WORKER, mode, String(timeoutMs), a];
  if (b !== undefined) args.push(b);
  return run(process.execPath, args, timeoutMs + 30_000, { env: workerEnv() });
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
          console.warn("[peach] openssh missing — falling back to ssh2 worker");
        }
      }
      const r = await ssh2Worker("exec", timeoutMs, remoteCmd);
      if (r.code !== 0) {
        throw new Error(`ssh2 failed (${r.code}): ${(r.stderr || r.stdout).slice(0, 500)}`);
      }
      return r.stdout;
    },
    5,
    "ssh",
  );
}

/** Upload one file via ssh stdin / ssh2 worker (no scp.exe). */
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
      const r = await ssh2Worker("upload", timeoutMs, localPath, remotePath);
      if (r.code !== 0) {
        throw new Error(`ssh2 upload failed (${r.code}): ${(r.stderr || r.stdout).slice(0, 500)}`);
      }
    },
    4,
    "upload-file",
  );
}

function dirByteSizeSync(dir: string): number {
  let total = 0;
  const walk = (p: string) => {
    for (const name of fs.readdirSync(p)) {
      const full = path.join(p, name);
      const st = fs.statSync(full);
      if (st.isDirectory()) walk(full);
      else total += st.size;
    }
  };
  walk(dir);
  return total;
}

/** Timeout scales with payload; stall-prone pipes used to burn a fixed 15 min. */
export function uploadDirTimeoutMs(localDir: string, overrideMs?: number): number {
  if (overrideMs && overrideMs > 0) return overrideMs;
  const bytes = dirByteSizeSync(localDir);
  // Assume worst ~50 KB/s over SSH tunnel + 2 min floor, 12 min ceiling for normal LoRA sets.
  const bySize = Math.ceil(bytes / 50_000) * 1000 + 120_000;
  return Math.min(720_000, Math.max(180_000, bySize));
}

/** Upload directory as one compressed archive over SSH/SFTP (Railway-safe). */
export async function metalnodeScpDirTo(
  localDir: string,
  remoteDir: string,
  timeoutMs?: number,
) {
  const files = fs.readdirSync(localDir);
  if (!files.length) throw new Error("local dataset empty");

  const ms = uploadDirTimeoutMs(localDir, timeoutMs);
  const bytes = dirByteSizeSync(localDir);
  console.warn(
    `[peach] upload-dir start bytes≈${bytes} timeoutSec=${Math.round(ms / 1000)} → ${remoteDir}`,
  );

  await metalnodeSsh(`mkdir -p ${JSON.stringify(remoteDir)}`, 90_000);

  return withRetry(
    async () => {
      if (hasOpenSsh()) {
        try {
          const { args, target } = sshBaseArgs();
          const remoteCmd = `mkdir -p ${JSON.stringify(remoteDir)} && tar -xzf - -C ${JSON.stringify(remoteDir)}`;
          const r = await new Promise<{ code: number; stdout: string; stderr: string }>(
            (resolve, reject) => {
              const ssh = spawn(SSH_BIN, [...args, target, remoteCmd], {
                windowsHide: true,
                stdio: ["pipe", "pipe", "pipe"],
                env: process.env,
              });
              const tar = spawn(TAR_BIN, ["-czf", "-", "-C", localDir, "."], {
                windowsHide: true,
                stdio: ["ignore", "pipe", "pipe"],
              });

              let stdout = "";
              let stderr = "";
              const t = setTimeout(() => {
                tar.kill();
                ssh.kill();
                reject(new Error(`tar|ssh timeout after ${Math.round(ms / 1000)}s`));
              }, ms);

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
          console.warn("[peach] openssh missing for upload — falling back to ssh2 worker");
        }
      }
      const r = await ssh2Worker("upload-dir", ms, localDir, remoteDir);
      if (r.code !== 0) {
        throw new Error(
          `ssh2 upload-dir failed (${r.code}): ${(r.stderr || r.stdout).slice(0, 600)}`,
        );
      }
    },
    3,
    "upload-dir",
  );
}

export async function metalnodeCheck(): Promise<{ ok: boolean; detail: string }> {
  try {
    ensureMetalnodeKeyFile();
    const out = await metalnodeSsh("echo PONG", 75_000);
    if (out.includes("PONG")) {
      return { ok: true, detail: hasOpenSsh() ? "openssh" : "ssh2-worker" };
    }
    return { ok: false, detail: `unexpected: ${out.slice(0, 200)}` };
  } catch (e) {
    return {
      ok: false,
      detail: e instanceof Error ? e.message : String(e),
    };
  }
}
