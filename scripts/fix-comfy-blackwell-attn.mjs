#!/usr/bin/env node
/**
 * Patch Metalnode Comfy launch for RTX 5090 (Blackwell): force PyTorch SDPA
 * instead of xformers (fixes SAM3_Detect NotImplementedError).
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const cfg = JSON.parse(
  fs.readFileSync(path.join(ROOT, "infra", "metalnode.local.json"), "utf8"),
);

const REMOTE = `set -euo pipefail
F=/work/bin/start-comfy.sh
echo "=== BEFORE ==="
cat "$F" 2>/dev/null || echo "MISSING start-comfy.sh"

mkdir -p /work/bin /work/logs
if [[ ! -f "$F" ]]; then
  cat > "$F" <<'EOF'
#!/bin/bash
set -euo pipefail
cd /work/ComfyUI
exec /work/ai/venv/bin/python main.py --listen --port 8188 --enable-manager --use-pytorch-cross-attention
EOF
  chmod +x "$F"
else
  cp -a "$F" "$F.bak_before_blackwell_attn_$(date +%Y%m%d_%H%M%S)"
  if ! grep -q 'use-pytorch-cross-attention' "$F"; then
    sed -i 's|--enable-manager|--enable-manager --use-pytorch-cross-attention|g' "$F"
    if ! grep -q 'use-pytorch-cross-attention' "$F"; then
      sed -i 's|main.py --listen --port 8188|main.py --listen --port 8188 --use-pytorch-cross-attention|g' "$F"
    fi
  fi
fi

echo "=== AFTER ==="
cat "$F"

# Kill any Comfy without the flag and restart via start script
tmux kill-session -t comfy 2>/dev/null || true
pkill -f 'python main.py' 2>/dev/null || true
sleep 3

# Prefer tmux session if run script exists
if [[ -x /work/bin/run-comfy-tmux.sh ]]; then
  /work/bin/run-comfy-tmux.sh || true
fi
if ! tmux has-session -t comfy 2>/dev/null; then
  nohup "$F" >/work/logs/comfyui.log 2>&1 &
fi

for i in $(seq 1 45); do
  if curl -sf http://127.0.0.1:8188/system_stats >/dev/null; then
    echo "COMFY_UP attempt=$i"
    break
  fi
  sleep 2
done

echo "=== PROCESS ==="
ps aux | grep 'main.py' | grep -v grep || true
echo "=== LOG TAIL ==="
tail -30 /work/logs/comfyui.log 2>/dev/null || tail -30 /work/comfy_restart.log 2>/dev/null || true
`;

function sshArgs() {
  return [
    "-i",
    cfg.sshKeyPath,
    "-p",
    String(cfg.sshPort),
    "-o",
    "BatchMode=yes",
    "-o",
    "StrictHostKeyChecking=accept-new",
    "-o",
    "ConnectTimeout=90",
    "-o",
    "ServerAliveInterval=15",
    "-o",
    "ServerAliveCountMax=6",
    `${cfg.sshUser}@${cfg.host}`,
    "bash -s",
  ];
}

const r = spawnSync("ssh.exe", sshArgs(), {
  input: REMOTE,
  encoding: "utf8",
  timeout: 180_000,
  windowsHide: true,
  maxBuffer: 10 * 1024 * 1024,
});

process.stdout.write(r.stdout || "");
process.stderr.write(r.stderr || "");
if (r.status !== 0) {
  console.error(`ssh exit ${r.status}`);
  process.exit(r.status ?? 1);
}
