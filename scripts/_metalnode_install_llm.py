#!/usr/bin/env python3
"""Install Ollama + download Gemma 4 31B Heretic Q5_K_M GGUF and create model."""
from pathlib import Path
import sys
import paramiko

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
KEY = Path(r"C:\Users\Олег\Downloads\metalnode_id_ed25519 (6).txt")

REMOTE = r'''#!/bin/bash
set -e
export DEBIAN_FRONTEND=noninteractive

echo "=== 1. Install Ollama ==="
if ! command -v ollama >/dev/null 2>&1; then
  curl -fsSL https://ollama.com/install.sh | sh
else
  echo "ollama already installed: $(ollama --version)"
fi

# ensure service running
systemctl enable ollama 2>/dev/null || true
systemctl start ollama 2>/dev/null || true
# if no systemd service, start manually
if ! curl -sf http://127.0.0.1:11434/api/tags >/dev/null 2>&1; then
  echo "Starting ollama serve in background..."
  nohup ollama serve >/work/ollama_serve.log 2>&1 &
  sleep 3
fi
curl -sf http://127.0.0.1:11434/api/tags >/dev/null && echo "OLLAMA_UP" || echo "OLLAMA_DOWN"

echo "=== 2. List HF GGUF files ==="
mkdir -p /work/llm/gguf
cd /work/llm/gguf

# Use huggingface_hub if available, else curl
python3 - <<'PY'
import json, urllib.request
url = "https://huggingface.co/api/models/mradermacher/gemma-4-31B-it-heretic-GGUF/tree/main"
try:
    data = json.loads(urllib.request.urlopen(url, timeout=60).read())
    for f in data:
        p = f.get("path","")
        if p.endswith(".gguf") and ("Q5_K_M" in p or "Q6_K" in p or "Q4_K_M" in p):
            print(f"{p}\t{f.get('size',0)/1e9:.2f} GB")
except Exception as e:
    print("API_ERR", e)
PY

echo "=== 3. Download Q5_K_M (best quality that fits 32GB with context) ==="
# Exact filename from mradermacher convention
FILE="gemma-4-31B-it-heretic.Q5_K_M.gguf"
URL="https://huggingface.co/mradermacher/gemma-4-31B-it-heretic-GGUF/resolve/main/${FILE}"

if [ -f "$FILE" ] && [ $(stat -c%s "$FILE") -gt 10000000000 ]; then
  echo "Already downloaded: $FILE ($(du -h $FILE | cut -f1))"
else
  echo "Downloading $URL ..."
  # try hf_transfer / huggingface-cli first
  if /work/ai/venv/bin/python -c "import huggingface_hub" 2>/dev/null; then
    /work/ai/venv/bin/python - <<PY
from huggingface_hub import hf_hub_download
import os
os.chdir("/work/llm/gguf")
path = hf_hub_download(
    repo_id="mradermacher/gemma-4-31B-it-heretic-GGUF",
    filename="$FILE",
    local_dir="/work/llm/gguf",
    local_dir_use_symlinks=False,
)
print("DOWNLOADED", path)
PY
  else
    # fallback curl with resume
    curl -L --retry 5 --continue-at - -o "$FILE.partial" "$URL"
    mv "$FILE.partial" "$FILE"
  fi
fi

ls -lh /work/llm/gguf/*.gguf 2>/dev/null | head -10
'''

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
pkey = paramiko.Ed25519Key.from_private_key_file(str(KEY))
c.connect("77.94.203.13", port=22024, username="root", pkey=pkey, timeout=30, allow_agent=False, look_for_keys=False)
sftp = c.open_sftp()
with sftp.file("/work/_install_llm.sh", "w") as f:
    f.write(REMOTE)
sftp.close()
# long download — run in background on remote via nohup, then poll
stdin, stdout, stderr = c.exec_command(
    "nohup bash /work/_install_llm.sh > /work/LLM_INSTALL.log 2>&1 & echo PID:$!",
    timeout=30,
)
print(stdout.read().decode(errors="replace"))
print(stderr.read().decode(errors="replace"))
c.close()
print("Started remote install in background. Polling log...")
