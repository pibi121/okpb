/**
 * Stable Metalnode SSH tunnel (Comfy :8188 + Ollama :11434).
 * Reads infra/metalnode.local.json with UTF-8 (avoids PowerShell path mojibake).
 * Auto-reconnects on drop.
 *
 * Metalnode's SSH gateway closes idle sessions in ~5s (including -N, login
 * shells with no output, and `sleep`). Keep the exec channel busy with a
 * flushed echo loop so port forwards stay up.
 *
 *   node scripts/metalnode-tunnel.mjs
 *   node scripts/metalnode-tunnel.mjs --once
 */
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import http from "node:http";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const ONCE = process.argv.includes("--once");
const KEEP = "while true; do echo k; sleep 2; done";

function loadCfg() {
  const p = path.join(ROOT, "infra", "metalnode.local.json");
  if (!fs.existsSync(p)) {
    throw new Error(`Missing ${p}`);
  }
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function freeLocalPorts(ports) {
  if (process.platform !== "win32") return;
  try {
    // Do NOT kill a healthy Paramiko Comfy tunnel — OpenSSH -L is the flaky one.
    // Only free the port if nothing answers /system_stats.
    const healthy = (() => {
      try {
        const r = spawnSync(
          "curl.exe",
          ["-s", "-o", "NUL", "-w", "%{http_code}", "--connect-timeout", "2", "http://127.0.0.1:8188/system_stats"],
          { encoding: "utf8", windowsHide: true },
        );
        return String(r.stdout || "").trim() === "200";
      } catch {
        return false;
      }
    })();
    if (healthy) {
      console.log("[tunnel] :8188 already healthy — skip freeLocalPorts");
      return;
    }
    const ps = `
foreach ($p in @(${ports.join(",")})) {
  Get-NetTCPConnection -LocalPort $p -State Listen -EA SilentlyContinue |
    ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -EA SilentlyContinue }
}
`;
    spawnSync("powershell", ["-NoProfile", "-Command", ps], {
      windowsHide: true,
    });
  } catch {
    /* ignore */
  }
}

function killStaleMetalnodeSsh(host, sshPort) {
  if (process.platform !== "win32") return;
  try {
    const ps = `
Get-CimInstance Win32_Process -Filter "Name='ssh.exe'" |
  Where-Object {
    $_.CommandLine -match [regex]::Escape('${host}') -and
    $_.CommandLine -match ('-p\\s+' + [regex]::Escape('${sshPort}'))
  } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -EA SilentlyContinue }
`;
    spawnSync("powershell", ["-NoProfile", "-Command", ps], {
      windowsHide: true,
    });
  } catch {
    /* ignore */
  }
}

function llmSplit() {
  return fs.existsSync(path.join(ROOT, "infra", "metalnode.llm.json"));
}

function gpuLocalPorts() {
  return llmSplit() ? [8188] : [8188, 11434];
}

function ping(url, timeoutMs = 2500) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      res.resume();
      resolve(res.statusCode >= 200 && res.statusCode < 500);
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
}

function sshArgs(cfg) {
  // Bind only IPv4 loopback — dual ::1+127.0.0.1 bind is flaky on some Windows OpenSSH builds.
  const forwards = ["-L", "127.0.0.1:8188:127.0.0.1:8188"];
  if (!llmSplit()) {
    forwards.push("-L", "127.0.0.1:11434:127.0.0.1:11434");
  }
  return [
    "-i",
    cfg.sshKeyPath,
    "-o",
    "BatchMode=yes",
    "-o",
    "IdentitiesOnly=yes",
    "-o",
    "ServerAliveInterval=15",
    "-o",
    "ServerAliveCountMax=6",
    "-o",
    "ExitOnForwardFailure=yes",
    "-o",
    "TCPKeepAlive=yes",
    "-o",
    "StrictHostKeyChecking=accept-new",
    "-o",
    "AddressFamily=inet",
    ...forwards,
    "-p",
    String(cfg.sshPort),
    `${cfg.sshUser}@${cfg.host}`,
    KEEP,
  ];
}

function attachSsh(child) {
  // Must drain stdout or the remote echo loop blocks on a full TCP window
  // and the gateway sees an idle session again.
  if (child.stdout) child.stdout.resume();
  if (child.stderr) {
    child.stderr.on("data", (buf) => {
      const s = buf.toString("utf8");
      if (s.trim()) process.stderr.write(s);
    });
  }
}

function pythonBin() {
  for (const name of ["py", "python", "python3"]) {
    const r = spawnSync(name, ["-c", "import paramiko"], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 15000,
    });
    if (r.status === 0) {
      // sys.executable often mojibakes Cyrillic usernames on Windows → spawn ENOENT.
      return name;
    }
  }
  return null;
}

/** Windows OpenSSH -L often exits 4294967295; Paramiko local forward is stable. */
function runParamikoOnce(cfg) {
  return new Promise((resolve) => {
    const script = path.join(ROOT, "scripts", "paramiko-comfy-tunnel.py");
    const py = pythonBin();
    if (!py) {
      console.error("[tunnel] python+paramiko not found");
      resolve(1);
      return;
    }
    console.log(`[tunnel] paramiko ${py} ${script}`);
    const child = spawn(py, [script], {
      cwd: ROOT,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const sshPid = child.pid;
    let lastOk = Date.now();
    let settled = false;
    const finish = (code) => {
      if (settled) return;
      settled = true;
      clearInterval(watcher);
      try {
        if (sshPid) process.kill(sshPid);
      } catch {
        /* ignore */
      }
      resolve(code ?? 1);
    };
    if (child.stdout) {
      child.stdout.on("data", (buf) => {
        const s = buf.toString("utf8").trim();
        if (s) console.log(s);
      });
    }
    if (child.stderr) {
      child.stderr.on("data", (buf) => {
        const s = buf.toString("utf8").trim();
        if (s) console.error(s);
      });
    }
    const watcher = setInterval(async () => {
      const ok = await ping("http://127.0.0.1:8188/system_stats", 5000);
      let alive = false;
      if (sshPid) {
        try {
          process.kill(sshPid, 0);
          alive = true;
        } catch {
          alive = false;
        }
      }
      if (ok) {
        lastOk = Date.now();
        return;
      }
      if (!alive && !ok) {
        console.warn("[tunnel] paramiko+comfy dead — reconnecting");
        finish(1);
        return;
      }
      if (!ok && Date.now() - lastOk > 60_000) {
        console.warn("[tunnel] Comfy down 60s — reconnecting");
        finish(1);
      }
    }, 5_000);
    child.on("error", (e) => {
      console.error("[tunnel] paramiko spawn error:", e.message);
      finish(1);
    });
    child.on("exit", (code) => {
      if (process.platform !== "win32") finish(code ?? 1);
    });
  });
}

function runSshOnce(cfg) {
  return new Promise((resolve) => {
    const ports = llmSplit() ? ":8188" : ":8188 :11434";
    console.log(
      `[tunnel] ssh ${cfg.sshUser}@${cfg.host}:${cfg.sshPort} → ${ports} (keepalive exec)`,
    );
    // Do NOT use detached on Windows — ssh dies immediately (exit 0xFFFFFFFF).
    // Keep stdio ignored and treat pid liveness + Comfy ping as source of truth.
    const child = spawn("ssh.exe", sshArgs(cfg), {
      stdio: ["ignore", "ignore", "ignore"],
      windowsHide: true,
    });
    const sshPid = child.pid;
    let lastOk = Date.now();
    let settled = false;
    const finish = (code) => {
      if (settled) return;
      settled = true;
      clearInterval(watcher);
      try {
        if (sshPid) process.kill(sshPid);
      } catch {
        /* ignore */
      }
      resolve(code ?? 1);
    };

    const pidAlive = () => {
      if (!sshPid) return false;
      try {
        process.kill(sshPid, 0);
        return true;
      } catch {
        return false;
      }
    };

    const watcher = setInterval(async () => {
      const ok = await ping("http://127.0.0.1:8188/system_stats", 5000);
      const alive = pidAlive();
      if (ok) {
        lastOk = Date.now();
        return;
      }
      if (!alive && !ok) {
        console.warn("[tunnel] ssh+comfy dead — reconnecting");
        finish(1);
        return;
      }
      if (!ok && Date.now() - lastOk > 60_000) {
        console.warn("[tunnel] Comfy down 60s — reconnecting");
        finish(1);
      }
    }, 5_000);

    child.on("error", (e) => {
      console.error("[tunnel] spawn error:", e.message);
      finish(1);
    });
    // Ignore 'exit' on Windows — it often fires spuriously while ssh is still up.
    child.on("exit", (code) => {
      if (process.platform !== "win32") finish(code ?? 1);
    });
  });
}

async function waitLocal(timeoutMs = 45_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const comfy = await ping("http://127.0.0.1:8188/system_stats");
    const ollamaUrl = llmSplit()
      ? "http://127.0.0.1:11435/api/tags"
      : "http://127.0.0.1:11434/api/tags";
    const ollama = await ping(ollamaUrl);
    if (comfy) {
      console.log(`[tunnel] local OK comfy=${comfy} ollama=${ollama}`);
      return true;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

async function main() {
  const cfg = loadCfg();
  if (!fs.existsSync(cfg.sshKeyPath)) {
    throw new Error(`SSH key not found: ${cfg.sshKeyPath}`);
  }

  const lockPath = path.join(ROOT, "data", "logs", "tunnel.pid");
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });

  if (!ONCE && fs.existsSync(lockPath)) {
    try {
      const oldPid = Number(fs.readFileSync(lockPath, "utf8").trim());
      if (oldPid && oldPid !== process.pid) {
        let alive = false;
        try {
          process.kill(oldPid, 0);
          alive = true;
        } catch {
          alive = false;
        }
        const comfyUp = await ping("http://127.0.0.1:8188/system_stats");
        const ollamaUp = await ping(
          llmSplit()
            ? "http://127.0.0.1:11435/api/tags"
            : "http://127.0.0.1:11434/api/tags",
        );
        if (alive && comfyUp && ollamaUp) {
          console.log(`[tunnel] already running pid=${oldPid}, exiting`);
          return;
        }
        if (alive) {
          console.warn(
            `[tunnel] stale keepalive pid=${oldPid} (ports down) — taking over`,
          );
          try {
            process.kill(oldPid);
          } catch {
            /* ignore */
          }
          await new Promise((r) => setTimeout(r, 1000));
        }
      }
    } catch {
      /* ignore */
    }
  }

  if (!ONCE) {
    fs.writeFileSync(lockPath, String(process.pid));
    const clearLock = () => {
      try {
        if (fs.existsSync(lockPath)) {
          const cur = fs.readFileSync(lockPath, "utf8").trim();
          if (cur === String(process.pid)) fs.unlinkSync(lockPath);
        }
      } catch {
        /* ignore */
      }
    };
    process.on("exit", clearLock);
    process.on("SIGINT", () => {
      clearLock();
      process.exit(0);
    });
    process.on("SIGTERM", () => {
      clearLock();
      process.exit(0);
    });
  }

  killStaleMetalnodeSsh(cfg.host, cfg.sshPort);
  await new Promise((r) => setTimeout(r, 800));
  freeLocalPorts(gpuLocalPorts());
  await new Promise((r) => setTimeout(r, 800));

  if (ONCE) {
    const child = spawn("ssh.exe", sshArgs(cfg), {
      stdio: ["ignore", "ignore", "ignore"],
      windowsHide: true,
    });
    console.log(`[tunnel] started pid=${child.pid}`);
    const ok = await waitLocal();
    if (!ok) {
      try {
        if (child.pid) process.kill(child.pid);
      } catch {
        /* ignore */
      }
      process.exit(1);
    }
    // Keep parent alive so Windows doesn't reap the ssh child with the console.
    console.log(`[tunnel] handoff — keeping supervisor for ssh pid=${child.pid}`);
    await new Promise(() => {});
  }

  for (;;) {
    freeLocalPorts(gpuLocalPorts());
    await new Promise((r) => setTimeout(r, 500));
    const code =
      process.platform === "win32"
        ? await runParamikoOnce(cfg)
        : await runSshOnce(cfg);
    const backoff = code === 255 ? 8_000 : 5_000;
    console.warn(`[tunnel] exited ${code}, reconnect in ${backoff / 1000}s…`);
    await new Promise((r) => setTimeout(r, backoff));
  }
}

main().catch((e) => {
  console.error("[tunnel]", e.message || e);
  process.exit(1);
});
