import { spawn } from "node:child_process";
import fs from "fs";
import path from "path";
import { loadMetalnodeConfig } from "@/lib/metalnode-config";

const IS_WIN = process.platform === "win32";
const SSH_BIN = IS_WIN ? "ssh.exe" : "ssh";
const TAR_BIN = IS_WIN ? "tar.exe" : "tar";

function sshBaseArgs(extra: string[] = []) {
  const cfg = loadMetalnodeConfig();
  if (!fs.existsSync(cfg.sshKeyPath)) {
    throw new Error(`SSH key not found: ${cfg.sshKeyPath}`);
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
    cfg,
    args: [
      "-i",
      cfg.sshKeyPath,
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
        const reset = /reset|timed out|timeout|refused|banner exchange/i.test(msg);
        await new Promise((r) => setTimeout(r, reset ? 4000 * (i + 1) : 2000 * (i + 1)));
      }
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
}

export async function metalnodeSsh(remoteCmd: string, timeoutMs = 180_000) {
  return withRetry(async () => {
    const { args, target } = sshBaseArgs();
    const r = await run(SSH_BIN, [...args, target, remoteCmd], timeoutMs);
    if (r.code !== 0) {
      throw new Error(`ssh failed (${r.code}): ${(r.stderr || r.stdout).slice(0, 500)}`);
    }
    return r.stdout;
  }, 5, "ssh");
}

/** Upload one file via ssh stdin (no scp.exe). */
export async function metalnodeScpTo(localPath: string, remotePath: string, timeoutMs = 300_000) {
  return withRetry(async () => {
    const bytes = fs.readFileSync(localPath);
    const { args, target } = sshBaseArgs();
    const remoteDir = remotePath.replace(/\/[^/]+$/, "");
    const cmd = `mkdir -p ${JSON.stringify(remoteDir)} && cat > ${JSON.stringify(remotePath)}`;
    const r = await run(SSH_BIN, [...args, target, cmd], timeoutMs, { input: bytes });
    if (r.code !== 0) {
      throw new Error(`upload failed (${r.code}): ${(r.stderr || r.stdout).slice(0, 500)}`);
    }
  }, 4, "upload-file");
}

/** Upload directory as one tar stream over a single SSH connection. */
export async function metalnodeScpDirTo(localDir: string, remoteDir: string, timeoutMs = 900_000) {
  const files = fs.readdirSync(localDir);
  if (!files.length) throw new Error("local dataset empty");

  await metalnodeSsh(
    `mkdir -p ${JSON.stringify(remoteDir)}`,
    90_000,
  );

  return withRetry(async () => {
    const { args, target } = sshBaseArgs();
    const remoteCmd = `mkdir -p ${JSON.stringify(remoteDir)} && tar -xf - -C ${JSON.stringify(remoteDir)}`;
    const r = await new Promise<{ code: number; stdout: string; stderr: string }>((resolve, reject) => {
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
    });

    if (r.code !== 0) {
      throw new Error(
        `dataset upload failed (${r.code}): ${(r.stderr || r.stdout).slice(0, 600)}`,
      );
    }
  }, 3, "upload-dir");
}

export async function metalnodeCheck(): Promise<{ ok: boolean; detail: string }> {
  try {
    const { args, target, cfg } = sshBaseArgs();
    if (!fs.existsSync(cfg.sshKeyPath)) {
      return { ok: false, detail: `нет ключа: ${cfg.sshKeyPath}` };
    }
    const r = await withRetry(
      async () => {
        const out = await run(SSH_BIN, [...args, target, "echo PONG"], 75_000);
        if (out.code !== 0 || !out.stdout.includes("PONG")) {
          throw new Error(
            `ssh ${out.code}: ${(out.stderr || out.stdout || "empty").slice(0, 300)}`,
          );
        }
        return out;
      },
      8,
      "ssh-check",
    );
    if (r.code === 0 && r.stdout.includes("PONG")) {
      return { ok: true, detail: "ok" };
    }
    return {
      ok: false,
      detail: `ssh ${r.code}: ${(r.stderr || r.stdout || "empty").slice(0, 300)}`,
    };
  } catch (e) {
    return {
      ok: false,
      detail: e instanceof Error ? e.message : String(e),
    };
  }
}
