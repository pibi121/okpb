#!/bin/bash
set -euo pipefail
echo "=== comfy processes ==="
pgrep -af 'main.py|ComfyUI' | head -20
ss -lntp | grep 8188 || netstat -lntp 2>/dev/null | grep 8188 || true

echo "=== restart log ==="
wc -l /tmp/comfyui_restart_qwen3.log
tail -80 /tmp/comfyui_restart_qwen3.log

echo "=== import Suite ==="
cd /work/ComfyUI
/work/ai/venv/bin/python - <<'PY'
import sys, traceback
sys.path.insert(0, '/work/ComfyUI')
sys.path.insert(0, '/work/ComfyUI/custom_nodes/TTS-Audio-Suite')
try:
    import nodes as suite_nodes
    print('imported nodes module', suite_nodes)
except Exception:
    traceback.print_exc()
try:
    import importlib.util
    spec = importlib.util.spec_from_file_location('tts_suite', '/work/ComfyUI/custom_nodes/TTS-Audio-Suite/__init__.py')
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    print('NODE_CLASS_MAPPINGS keys with qwen:', [k for k in getattr(mod, 'NODE_CLASS_MAPPINGS', {}) if 'qwen' in k.lower() or 'Qwen' in k])
    print('total mappings', len(getattr(mod, 'NODE_CLASS_MAPPINGS', {})))
except Exception:
    traceback.print_exc()
PY
