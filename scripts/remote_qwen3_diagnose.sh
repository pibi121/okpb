#!/bin/bash
set -euo pipefail
PY=/work/ai/venv/bin/python
SUITE=/work/ComfyUI/custom_nodes/TTS-Audio-Suite

echo "=== ROPE keys ==="
$PY - <<'PY'
from transformers.modeling_rope_utils import ROPE_INIT_FUNCTIONS
print(sorted(ROPE_INIT_FUNCTIONS.keys()))
PY

echo "=== config rope fields ==="
$PY - <<'PY'
import json
c=json.load(open("/work/ComfyUI/models/TTS/qwen3_tts/Qwen3-TTS-12Hz-1.7B-Base/config.json"))
tc=c.get("talker_config", {})
for k,v in tc.items():
    if "rope" in k.lower():
        print(k, "=", v)
# also top-level
for k,v in c.items():
    if "rope" in k.lower():
        print("top", k, "=", v)
PY

echo "=== docs mentions ==="
rg -n "KeyError|rope_type|default|ROPE_INIT" "$SUITE/docs" -g '*.md' | head -40 || true
rg -n "rope_type|ROPE_INIT|patch" "$SUITE/engines/qwen3_tts" | head -40 || true

echo "=== modeling line around 624 ==="
sed -n '600,650p' "$SUITE/engines/qwen3_tts/impl/qwen_tts/core/models/modeling_qwen3_tts.py"

echo "=== official pip qwen-tts? ==="
PIP=/work/ai/venv/bin/pip
$PIP index versions qwen-tts 2>/dev/null | head -5 || true
$PIP install 'qwen-tts==' 2>&1 | head -15 || true
