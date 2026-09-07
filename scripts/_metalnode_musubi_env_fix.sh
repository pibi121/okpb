#!/bin/bash
export PATH=/usr/bin:/bin:/usr/local/bin
set -uo pipefail
LOG=/work/KLEIN_MUSUBI_ENV.log
log(){ echo "[$(date +%H:%M:%S)] $*" | tee -a "$LOG"; }

# Fix DNS for pypi / github if needed
grep -vE 'pypi|pythonhosted|github.com' /etc/hosts > /tmp/hosts.clean || true
PYPI=$(getent ahostsv4 pypi.org | awk '{print $1; exit}')
FILES=$(getent ahostsv4 files.pythonhosted.org | awk '{print $1; exit}')
GH=$(getent ahostsv4 github.com | awk '{print $1; exit}')
log "DNS pypi=$PYPI files=$FILES gh=$GH"
[ -n "$PYPI" ] && echo "$PYPI pypi.org" >> /tmp/hosts.clean
[ -n "$FILES" ] && echo "$FILES files.pythonhosted.org" >> /tmp/hosts.clean
[ -n "$GH" ] && echo "$GH github.com" >> /tmp/hosts.clean
cp /tmp/hosts.clean /etc/hosts

# Prefer Comfy venv directly — already has torch
PY=/work/ai/venv/bin/python
PIP=/work/ai/venv/bin/pip
log "comfy_torch"
$PY -c 'import torch; print(torch.__version__, torch.cuda.is_available())'

# Install only missing light deps into Comfy venv
export PIP_DEFAULT_TIMEOUT=120
for pkg in toml voluptuous accelerate safetensors einops; do
  $PY -c "import ${pkg%%[*]}" 2>/dev/null && log "have $pkg" || {
    log "install $pkg"
    $PIP install --retries 10 "$pkg" 2>&1 | tee -a "$LOG" | tail -5
  }
done

# bitsandbytes optional
$PY -c 'import bitsandbytes' 2>/dev/null && log "have bnb" || {
  log "try bnb"
  $PIP install --retries 10 bitsandbytes 2>&1 | tee -a "$LOG" | tail -8 || true
}

# Make musubi importable without editable install
cd /work/train/musubi-tuner
export PYTHONPATH="/work/train/musubi-tuner/src:${PYTHONPATH:-}"
$PY - <<'PY'
import sys
sys.path.insert(0, "/work/train/musubi-tuner/src")
import musubi_tuner
print("musubi_import_ok", musubi_tuner.__file__)
import toml, voluptuous
print("deps_ok")
PY

# Write wrapper
cat > /work/train/musubi-tuner/run_py.sh <<'EOF'
#!/bin/bash
export PYTHONPATH="/work/train/musubi-tuner/src:${PYTHONPATH:-}"
export PATH="/work/ai/venv/bin:/usr/bin:/bin"
exec /work/ai/venv/bin/python "$@"
EOF
chmod +x /work/train/musubi-tuner/run_py.sh

# Check accelerate
/work/ai/venv/bin/accelerate env 2>&1 | head -20 | tee -a "$LOG" || true
log "ENV_OK"
