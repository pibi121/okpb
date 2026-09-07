#!/bin/bash
# Install musubi-tuner venv (reuse Comfy torch via system-site-packages)
set -euo pipefail
export PATH=/usr/bin:/bin:/usr/local/bin
LOG=/work/KLEIN_MUSUBI_ENV.log
: > "$LOG"
log(){ echo "[$(date +%H:%M:%S)] $*" | tee -a "$LOG"; }

cd /work/train/musubi-tuner
if [ ! -d venv ]; then
  log "CREATE_VENV"
  /work/ai/venv/bin/python -m venv --system-site-packages venv
fi
. venv/bin/activate
log "pip_install"
python -m pip -q install -U pip setuptools wheel
# requirements may pull a lot; prefer existing torch
pip -q install -e . 2>&1 | tee -a "$LOG" | tail -30 || pip install -e . 2>&1 | tee -a "$LOG" | tail -40
# common extras
pip -q install toml voluptuous accelerate bitsandbytes 2>&1 | tee -a "$LOG" | tail -10 || true
python - <<'PY'
import torch
print('torch', torch.__version__, 'cuda', torch.cuda.is_available())
import musubi_tuner
print('musubi_ok')
PY
log "ENV_OK"
