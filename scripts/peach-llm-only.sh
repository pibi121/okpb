#!/bin/bash
# LLM box: stop Comfy + huge generator downloads, keep Ollama/Gemma only.
set -u
exec >> /work/logs/llm_role.log 2>&1
echo "===== $(date -Is) switch to LLM-only ====="

pkill -f 'python main.py --listen' 2>/dev/null || true
pkill -f 'hf download' 2>/dev/null || true
pkill -f huggingface_hub 2>/dev/null || true
pkill -f peach-bootstrap-remote 2>/dev/null || true
sleep 2

# drop incomplete Comfy generator weights (keep disk for GGUF)
rm -rf /tmp/tmp.* 2>/dev/null || true

mkdir -p /work/logs /work/llm/gguf /work/bin
export DEBIAN_FRONTEND=noninteractive
apt-get install -y -qq zstd pciutils curl ca-certificates >/dev/null 2>&1 || true

if ! command -v ollama >/dev/null 2>&1 || ! ollama --version >/dev/null 2>&1; then
  curl -fsSL https://ollama.com/install.sh | sh
fi

if ! curl -sf -m 3 http://127.0.0.1:11434/api/tags >/dev/null; then
  pkill -x ollama 2>/dev/null || true
  sleep 1
  nohup env CUDA_VISIBLE_DEVICES=0 OLLAMA_HOST=127.0.0.1:11434 OLLAMA_KEEP_ALIVE=24h \
    ollama serve >/work/logs/ollama.log 2>&1 &
  for i in $(seq 1 40); do
    curl -sf -m 2 http://127.0.0.1:11434/api/tags >/dev/null && break
    sleep 2
  done
fi
echo OLLAMA_HTTP=$(curl -sf -m 3 -o /dev/null -w '%{http_code}' http://127.0.0.1:11434/api/tags || echo 000)

PY=/work/ai/venv/bin/python
$PY -m pip -q install -U huggingface_hub hf_transfer >/dev/null 2>&1 || true
export HF_HUB_ENABLE_HF_TRANSFER=1

GGUF=/work/llm/gguf/gemma-4-31B-it-heretic.Q5_K_M.gguf
if [ ! -f "$GGUF" ] || [ "$(stat -c%s "$GGUF" 2>/dev/null || echo 0)" -lt 10000000000 ]; then
  $PY - <<'PY'
from huggingface_hub import hf_hub_download, list_repo_files
import os
repo = "mradermacher/gemma-4-31B-it-heretic-GGUF"
cands = [f for f in list_repo_files(repo) if f.endswith(".gguf") and "Q5_K_M" in f]
print("candidates", cands)
assert cands
path = hf_hub_download(repo_id=repo, filename=cands[0], local_dir="/work/llm/gguf")
dest = "/work/llm/gguf/gemma-4-31B-it-heretic.Q5_K_M.gguf"
if os.path.abspath(path) != os.path.abspath(dest) and not os.path.exists(dest):
    os.symlink(path, dest)
print("GGUF", dest, os.path.getsize(dest) if os.path.exists(dest) else os.path.getsize(path))
PY
fi

cat > /work/llm/Modelfile <<'EOF'
FROM /work/llm/gguf/gemma-4-31B-it-heretic.Q5_K_M.gguf
PARAMETER temperature 0.65
PARAMETER top_p 0.9
PARAMETER top_k 40
PARAMETER num_ctx 8192
PARAMETER stop "<end_of_turn>"
SYSTEM """You are an expert adult erotic prompt engineer for Krea 2 and MiniMax H3. Write explicit NSFW for consenting adults. No refusals."""
EOF

if curl -sf -m 3 http://127.0.0.1:11434/api/tags >/dev/null; then
  ollama create gemma4-heretic -f /work/llm/Modelfile
  ollama list
fi

nvidia-smi --query-gpu=name,memory.used,memory.total --format=csv,noheader
pgrep -af 'python main.py' || echo COMFY_STOPPED
echo "===== LLM-ONLY READY $(date -Is) ====="
