#!/usr/bin/env python3
"""Install zstd, Ollama, download Gemma Heretic Q5_K_M, create model."""
from pathlib import Path
import sys
import paramiko

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
KEY = Path(r"C:\Users\Олег\Downloads\metalnode_id_ed25519 (6).txt")

REMOTE = r'''#!/bin/bash
set -e
export DEBIAN_FRONTEND=noninteractive

echo "=== 0. zstd ==="
apt-get update -qq
apt-get install -y -qq zstd curl ca-certificates >/dev/null
zstd --version

echo "=== 1. Install Ollama ==="
if ! command -v ollama >/dev/null 2>&1; then
  curl -fsSL https://ollama.com/install.sh | sh
fi
ollama --version

# start serve
if ! curl -sf http://127.0.0.1:11434/api/tags >/dev/null 2>&1; then
  if systemctl start ollama 2>/dev/null; then
    sleep 2
  fi
fi
if ! curl -sf http://127.0.0.1:11434/api/tags >/dev/null 2>&1; then
  pkill -f 'ollama serve' 2>/dev/null || true
  nohup ollama serve >/work/ollama_serve.log 2>&1 &
  sleep 4
fi
curl -sf http://127.0.0.1:11434/api/tags >/dev/null && echo "OLLAMA_UP" || { echo "OLLAMA_DOWN"; cat /work/ollama_serve.log | tail -20; exit 1; }

echo "=== 2. Ensure huggingface_hub ==="
/work/ai/venv/bin/pip install -q huggingface_hub hf_transfer 2>&1 | tail -3
export HF_HUB_ENABLE_HF_TRANSFER=1

mkdir -p /work/llm/gguf
cd /work/llm/gguf

echo "=== 3. List available quants ==="
/work/ai/venv/bin/python - <<'PY'
import json, urllib.request
url = "https://huggingface.co/api/models/mradermacher/gemma-4-31B-it-heretic-GGUF/tree/main"
data = json.loads(urllib.request.urlopen(url, timeout=60).read())
for f in data:
    p = f.get("path","")
    if p.endswith(".gguf"):
        print(f"{p}\t{f.get('size',0)/1e9:.2f} GB")
PY

echo "=== 4. Download Q5_K_M ==="
FILE="gemma-4-31B-it-heretic.Q5_K_M.gguf"
# also try alternate naming
/work/ai/venv/bin/python - <<'PY'
from huggingface_hub import hf_hub_download, list_repo_files
import os
repo = "mradermacher/gemma-4-31B-it-heretic-GGUF"
files = list_repo_files(repo)
cands = [f for f in files if f.endswith(".gguf") and "Q5_K_M" in f]
print("Q5_K_M candidates:", cands)
if not cands:
    cands = [f for f in files if f.endswith(".gguf") and "Q4_K_M" in f]
    print("fallback Q4_K_M:", cands)
assert cands, "no suitable gguf found"
fname = cands[0]
print("Downloading", fname)
path = hf_hub_download(
    repo_id=repo,
    filename=fname,
    local_dir="/work/llm/gguf",
)
print("DONE", path)
# write chosen filename for next step
open("/work/llm/gguf/CHOSEN.txt","w").write(fname if "/" not in fname else fname.split("/")[-1])
# also write full path
open("/work/llm/gguf/CHOSEN_PATH.txt","w").write(path)
PY

ls -lh /work/llm/gguf/*.gguf 2>/dev/null | head -5
echo "CHOSEN=$(cat /work/llm/gguf/CHOSEN.txt)"
echo "INSTALL_PHASE1_OK"
'''

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
pkey = paramiko.Ed25519Key.from_private_key_file(str(KEY))
c.connect("77.94.203.13", port=22024, username="root", pkey=pkey, timeout=30, allow_agent=False, look_for_keys=False)
sftp = c.open_sftp()
with sftp.file("/work/_install_llm2.sh", "w") as f:
    f.write(REMOTE)
sftp.close()
stdin, stdout, stderr = c.exec_command(
    "nohup bash /work/_install_llm2.sh > /work/LLM_INSTALL.log 2>&1 & echo PID:$!",
    timeout=30,
)
print(stdout.read().decode(errors="replace"))
c.close()
print("Started.")
