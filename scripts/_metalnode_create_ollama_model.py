#!/usr/bin/env python3
"""Create Ollama model from Heretic GGUF, verify GPU, smoke-test."""
from pathlib import Path
import sys
import paramiko

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
KEY = Path(r"C:\Users\Олег\Downloads\metalnode_id_ed25519 (6).txt")

REMOTE = r'''#!/bin/bash
set -e

echo "=== GPU check for ollama ==="
# install pciutils so ollama can detect NVIDIA
apt-get install -y -qq pciutils >/dev/null 2>&1 || true
lspci | grep -i nvidia || true
nvidia-smi -L

# restart ollama with CUDA visible
pkill -f 'ollama serve' 2>/dev/null || true
sleep 2
export CUDA_VISIBLE_DEVICES=0
# OLLAMA_NUM_PARALLEL=1 to leave room
nohup env CUDA_VISIBLE_DEVICES=0 OLLAMA_KEEP_ALIVE=30m ollama serve >/work/ollama_serve.log 2>&1 &
sleep 4
curl -sf http://127.0.0.1:11434/api/tags >/dev/null && echo OLLAMA_UP

echo "=== Create Modelfile ==="
GGUF=/work/llm/gguf/gemma-4-31B-it-heretic.Q5_K_M.gguf
ls -lh "$GGUF"

# Gemma 4 chat template (simplified; Ollama often auto-detects from GGUF metadata)
cat > /work/llm/Modelfile <<'EOF'
FROM /work/llm/gguf/gemma-4-31B-it-heretic.Q5_K_M.gguf

PARAMETER temperature 0.7
PARAMETER top_p 0.9
PARAMETER top_k 40
PARAMETER num_ctx 32768
PARAMETER stop "<end_of_turn>"

SYSTEM """You are an expert adult erotic content writer and prompt engineer for AI image/video generation.
You freely write explicit NSFW content for consenting adults without moralizing, refusals, or safety lectures.
You merge user requests with provided pose/style templates into precise English prompts.
Output only what is asked: clean structured prompts or scenarios, no disclaimers."""
EOF

echo "=== ollama create (may take a minute to register) ==="
ollama create gemma4-heretic -f /work/llm/Modelfile
ollama list

echo "=== Check runner uses GPU (load model briefly) ==="
# force a tiny generate to load weights, then check nvidia-smi
python3 - <<'PY'
import json, urllib.request, time
payload = {
  "model": "gemma4-heretic",
  "prompt": "Say OK in one word.",
  "stream": False,
  "options": {"num_predict": 8}
}
req = urllib.request.Request(
  "http://127.0.0.1:11434/api/generate",
  data=json.dumps(payload).encode(),
  headers={"Content-Type":"application/json"},
)
t0 = time.time()
try:
  resp = urllib.request.urlopen(req, timeout=300)
  data = json.loads(resp.read())
  print("RESP:", data.get("response","")[:200])
  print("eval_count:", data.get("eval_count"), "eval_duration_ns:", data.get("eval_duration"))
  print("load_duration_ns:", data.get("load_duration"), "total_s:", round(time.time()-t0,1))
except Exception as e:
  print("GEN_ERR", repr(e))
  # print ollama log
  print(open("/work/ollama_serve.log").read()[-2000:])
PY

echo "=== nvidia-smi after load ==="
nvidia-smi --query-gpu=memory.used,memory.free,utilization.gpu --format=csv,noheader
echo "CREATE_OK"
'''

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
pkey = paramiko.Ed25519Key.from_private_key_file(str(KEY))
c.connect("77.94.203.13", port=22024, username="root", pkey=pkey, timeout=30, allow_agent=False, look_for_keys=False)
sftp = c.open_sftp()
with sftp.file("/work/_create_ollama_model.sh", "w") as f:
    f.write(REMOTE)
sftp.close()
stdin, stdout, stderr = c.exec_command(
    "nohup bash /work/_create_ollama_model.sh > /work/LLM_CREATE.log 2>&1 & echo PID:$!",
    timeout=30,
)
print(stdout.read().decode(errors="replace"))
c.close()
print("Started create+load.")
