#!/bin/bash
set -euo pipefail
PY=/work/ai/venv/bin/python
PIP=/work/ai/venv/bin/pip

echo "=== python ==="
$PY -c 'import sys; print(sys.version)'
$PY -c 'import transformers; print("transformers", transformers.__version__)'
$PIP show soundfile accelerate huggingface_hub librosa 2>/dev/null | awk '/^(Name|Version):/'

echo "=== female refs ==="
ls -la /work/ComfyUI/custom_nodes/TTS-Audio-Suite/voices_examples/female/ || true
cat /work/ComfyUI/custom_nodes/TTS-Audio-Suite/voices_examples/female/female_01.reference.txt 2>/dev/null || true
echo
cat "/work/ComfyUI/custom_nodes/TTS-Audio-Suite/voices_examples/Sophie_Anderson CC3.reference.txt" 2>/dev/null || true

echo "=== qwen API surface ==="
$PY <<'PY'
import sys
sys.path.insert(0, "/work/ComfyUI/custom_nodes/TTS-Audio-Suite/engines/qwen3_tts/impl")
from qwen_tts import Qwen3TTSModel
print("Qwen3TTSModel methods:", [m for m in dir(Qwen3TTSModel) if not m.startswith("_")])
import inspect
src = inspect.getsource(Qwen3TTSModel)
# print signatures of key methods
for name in ("from_pretrained", "generate_custom_voice", "generate_voice_clone", "generate_voice_design", "generate"):
    fn = getattr(Qwen3TTSModel, name, None)
    if fn:
        try:
            print(name, inspect.signature(fn))
        except Exception as e:
            print(name, "sig err", e)
PY
