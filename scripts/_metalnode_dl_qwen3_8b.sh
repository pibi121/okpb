#!/bin/bash
# Download official Qwen3-8B for musubi TE caching
export PATH=/usr/bin:/bin:/usr/local/bin
set -uo pipefail
export HF_HOME=/work/hf_cache
LOG=/work/loras_out/olh_person_klein_train.log
TE_DIR=/work/train/models/qwen3-8b
log(){ echo "[$(date +%H:%M:%S)] $*" | tee -a "$LOG"; }

mkdir -p "$TE_DIR"
# Clean poisoned hosts
grep -vE 'huggingface|hf\.co|xethub|pypi|pythonhosted' /etc/hosts > /tmp/hosts.clean || true
cp /tmp/hosts.clean /etc/hosts

PY=/work/ai/venv/bin/python
$PY -c 'import huggingface_hub; print(huggingface_hub.__version__)' || $PY -m pip -q install -U huggingface_hub hf_transfer

log "DOWNLOAD_QWEN3_8B"
$PY - <<'PY'
import os
os.environ.setdefault('HF_HOME','/work/hf_cache')
os.environ['HF_HUB_ENABLE_HF_TRANSFER']='1'
from huggingface_hub import snapshot_download
p=snapshot_download(
  repo_id='Qwen/Qwen3-8B',
  local_dir='/work/train/models/qwen3-8b',
  local_dir_use_symlinks=False,
  ignore_patterns=['*.md','*.txt','*.pdf','original/**','metal/**','gguf/**','*.gguf','*.bin'],
  max_workers=4,
)
print('DOWNLOADED', p)
import pathlib
files=sorted(pathlib.Path(p).rglob('*.safetensors'))
print('SAFE', len(files))
for f in files[:10]:
  print(f.name, f.stat().st_size)
PY
rc=$?
if [ "$rc" -ne 0 ]; then
  log "QWEN_DL_FAIL rc=$rc"
  exit 1
fi
ls -lh "$TE_DIR" | head -30 | tee -a "$LOG"
# first shard for musubi
FIRST=$(ls "$TE_DIR"/model-*-of-*.safetensors 2>/dev/null | sort | head -1)
if [ -z "$FIRST" ]; then
  FIRST=$(ls "$TE_DIR"/*.safetensors 2>/dev/null | head -1)
fi
echo "FIRST=$FIRST" | tee -a "$LOG"
ln -sfn "$TE_DIR" /work/train/models/qwen3-8b-link
log "QWEN_READY"
