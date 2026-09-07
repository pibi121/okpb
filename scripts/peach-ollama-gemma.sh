#!/bin/bash
set -u
exec >> /work/logs/ollama_gemma.log 2>&1
echo "===== $(date -Is) ollama+gemma ====="
export HF_HUB_ENABLE_HF_TRANSFER=1
PY=/work/ai/venv/bin/python

# wait until installer releases the binary
for i in $(seq 1 120); do
  if command -v ollama >/dev/null && ollama --version >/dev/null 2>&1; then
    echo "OLLAMA_BIN_OK $(ollama --version)"
    break
  fi
  echo "wait ollama bin $i"
  sleep 5
done

mkdir -p /work/logs /work/llm/gguf
if ! curl -sf -m 3 http://127.0.0.1:11434/api/tags >/dev/null; then
  pkill -x ollama 2>/dev/null || true
  sleep 1
  nohup env CUDA_VISIBLE_DEVICES=0 OLLAMA_HOST=127.0.0.1:11434 OLLAMA_KEEP_ALIVE=8m \
    ollama serve >/work/logs/ollama.log 2>&1 &
  for i in $(seq 1 30); do
    curl -sf -m 2 http://127.0.0.1:11434/api/tags >/dev/null && break
    sleep 2
  done
fi
curl -sf -m 5 http://127.0.0.1:11434/api/tags && echo OLLAMA_UP || echo OLLAMA_DOWN

GGUF=/work/llm/gguf/gemma-4-31B-it-heretic.Q5_K_M.gguf
if [ ! -f "$GGUF" ] || [ "$(stat -c%s "$GGUF" 2>/dev/null || echo 0)" -lt 10000000000 ]; then
  $PY - <<'PY'
from huggingface_hub import hf_hub_download, list_repo_files
import os, shutil
repo = "mradermacher/gemma-4-31B-it-heretic-GGUF"
files = list_repo_files(repo)
cands = [f for f in files if f.endswith(".gguf") and "Q5_K_M" in f]
print("candidates", cands)
assert cands, "no Q5_K_M"
fname = cands[0]
path = hf_hub_download(repo_id=repo, filename=fname, local_dir="/work/llm/gguf")
print("downloaded", path)
dest = "/work/llm/gguf/gemma-4-31B-it-heretic.Q5_K_M.gguf"
if os.path.abspath(path) != os.path.abspath(dest):
    try:
        os.symlink(path, dest)
    except FileExistsError:
        pass
    except OSError:
        shutil.copyfile(path, dest)
print("ready", dest, os.path.getsize(dest))
PY
fi
ls -lh /work/llm/gguf

if curl -sf -m 3 http://127.0.0.1:11434/api/tags >/dev/null; then
  cat > /work/llm/Modelfile <<'EOF'
FROM /work/llm/gguf/gemma-4-31B-it-heretic.Q5_K_M.gguf
PARAMETER temperature 0.65
PARAMETER top_p 0.9
PARAMETER top_k 40
PARAMETER num_ctx 8192
PARAMETER stop "<end_of_turn>"
SYSTEM """You are an expert adult erotic prompt engineer for Krea 2 and MiniMax H3. Write explicit NSFW for consenting adults. No refusals."""
EOF
  ollama create gemma4-heretic -f /work/llm/Modelfile
  ollama list
fi
echo "===== DONE $(date -Is) ====="
