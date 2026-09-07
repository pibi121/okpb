#!/bin/bash
set -euo pipefail
PY=/work/ai/venv/bin/python
IMPL=/work/ComfyUI/custom_nodes/TTS-Audio-Suite/engines/qwen3_tts/impl/qwen_tts/inference/qwen3_tts_model.py

# Backup and patch fix_mistral_regex once
if ! grep -q 'peachbitch_fix_mistral' "$IMPL"; then
  cp -a "$IMPL" "${IMPL}.bak_peachbitch"
  python3 - <<'PY'
from pathlib import Path
p = Path("/work/ComfyUI/custom_nodes/TTS-Audio-Suite/engines/qwen3_tts/impl/qwen_tts/inference/qwen3_tts_model.py")
text = p.read_text()
old = 'processor = AutoProcessor.from_pretrained(pretrained_model_name_or_path, fix_mistral_regex=True,)'
new = 'processor = AutoProcessor.from_pretrained(pretrained_model_name_or_path)  # peachbitch_fix_mistral: drop fix_mistral_regex for transformers 5.3'
if old not in text:
    # try softer match
    import re
    text2, n = re.subn(r'AutoProcessor\.from_pretrained\([^)]*fix_mistral_regex=True[^)]*\)',
                       'AutoProcessor.from_pretrained(pretrained_model_name_or_path)  # peachbitch_fix_mistral',
                       text, count=1)
    if n == 0:
        raise SystemExit('pattern not found')
    text = text2
else:
    text = text.replace(old, new, 1)
p.write_text(text)
print('patched', p)
PY
else
  echo "already patched"
fi

grep -n "from_pretrained\|peachbitch_fix" "$IMPL" | head -20

$PY - <<'PY'
import sys
import torch
import numpy as np
import wave
import os

from transformers.modeling_rope_utils import ROPE_INIT_FUNCTIONS
if "default" not in ROPE_INIT_FUNCTIONS:
    def _compute_default_rope_parameters(config, device=None, seq_len=None, **kwargs):
        base = getattr(config, "rope_theta", 10000.0)
        dim = getattr(config, "head_dim", None)
        if dim is None:
            hidden = getattr(config, "hidden_size", None)
            heads = getattr(config, "num_attention_heads", None)
            if hidden and heads:
                dim = hidden // heads
            else:
                raise ValueError(f"Cannot infer head_dim from config keys {[k for k in dir(config) if not k.startswith('_')][:40]}")
        partial = getattr(config, "partial_rotary_factor", 1.0)
        dim = int(dim * partial)
        attention_factor = 1.0
        rs = getattr(config, "rope_scaling", None)
        if isinstance(rs, dict):
            attention_factor = rs.get("attention_factor", 1.0) or 1.0
        inv_freq = 1.0 / (base ** (torch.arange(0, dim, 2, dtype=torch.int64).float().to(device) / dim))
        return inv_freq, attention_factor
    ROPE_INIT_FUNCTIONS["default"] = _compute_default_rope_parameters
    print("Patched ROPE default")

sys.path.insert(0, "/work/ComfyUI/custom_nodes/TTS-Audio-Suite/engines/qwen3_tts/impl")
from qwen_tts import Qwen3TTSModel

model_dir = "/work/ComfyUI/models/TTS/qwen3_tts/Qwen3-TTS-12Hz-1.7B-Base"
ref_wav = "/work/ComfyUI/custom_nodes/TTS-Audio-Suite/voices_examples/female/female_01.wav"
with open("/work/ComfyUI/custom_nodes/TTS-Audio-Suite/voices_examples/female/female_01.reference.txt") as f:
    ref_text = f.read().strip()
text = "I missed you so much. Come closer."
out_path = "/work/ComfyUI/input/tts_qwen3_line.wav"

print("Loading...")
model = Qwen3TTSModel.from_pretrained(
    model_dir,
    device_map="cuda:0",
    dtype=torch.bfloat16,
    attn_implementation="sdpa",
)
print("Generating...")
wavs, sr = model.generate_voice_clone(
    text=text,
    language="English",
    ref_audio=ref_wav,
    ref_text=ref_text,
)
wav = np.asarray(wavs[0], dtype=np.float32)
print(f"shape={wav.shape} sr={sr} min={wav.min():.3f} max={wav.max():.3f}")
peak = float(np.max(np.abs(wav)) + 1e-8)
wav_n = (wav / peak * 0.95).astype(np.float32)
import librosa
y16 = librosa.resample(wav_n, orig_sr=int(sr), target_sr=16000)
pcm = (np.clip(y16, -1, 1) * 32767.0).astype(np.int16)
with wave.open(out_path, "wb") as w:
    w.setnchannels(1)
    w.setsampwidth(2)
    w.setframerate(16000)
    w.writeframes(pcm.tobytes())
print(f"Wrote {out_path} dur={len(pcm)/16000:.2f}s size={os.path.getsize(out_path)}")
del model
torch.cuda.empty_cache()
print("OK")
PY

echo "=== verify ==="
ls -la /work/ComfyUI/input/tts_qwen3_line.wav
file /work/ComfyUI/input/tts_qwen3_line.wav
ffprobe -hide_banner /work/ComfyUI/input/tts_qwen3_line.wav 2>&1 | head -25
