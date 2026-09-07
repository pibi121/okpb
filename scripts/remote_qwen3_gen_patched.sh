#!/bin/bash
set -euo pipefail
PY=/work/ai/venv/bin/python

echo "=== find default rope helper ==="
$PY - <<'PY'
import transformers.modeling_rope_utils as m
names = [n for n in dir(m) if 'rope' in n.lower() or 'default' in n.lower()]
print(names)
for n in names:
    obj = getattr(m, n)
    if callable(obj):
        print("FN", n)
PY

# Try patching ROPE_INIT_FUNCTIONS['default'] and loading
$PY - <<'PY'
import sys
import torch
import numpy as np
import wave
import os

# Patch before importing model
from transformers.modeling_rope_utils import ROPE_INIT_FUNCTIONS
if "default" not in ROPE_INIT_FUNCTIONS:
    # Prefer official helper if present
    import transformers.modeling_rope_utils as m
    if hasattr(m, "_compute_default_rope_parameters"):
        ROPE_INIT_FUNCTIONS["default"] = m._compute_default_rope_parameters
        print("Patched default via _compute_default_rope_parameters")
    elif "linear" in ROPE_INIT_FUNCTIONS:
        # linear with factor 1 is effectively default for many models; better implement classic
        def _compute_default_rope_parameters(config, device=None, seq_len=None, **kwargs):
            base = getattr(config, "rope_theta", 10000.0)
            dim = getattr(config, "head_dim", None)
            if dim is None:
                # talker may use hidden_size // num_attention_heads
                hidden = getattr(config, "hidden_size", None)
                heads = getattr(config, "num_attention_heads", None)
                if hidden and heads:
                    dim = hidden // heads
                else:
                    raise ValueError(f"Cannot infer head_dim from {config}")
            # partial rotary?
            partial = getattr(config, "partial_rotary_factor", 1.0)
            dim = int(dim * partial)
            attention_factor = 1.0
            if getattr(config, "rope_scaling", None) is not None:
                attention_factor = config.rope_scaling.get("attention_factor", 1.0) or 1.0
            inv_freq = 1.0 / (base ** (torch.arange(0, dim, 2, dtype=torch.int64).float().to(device) / dim))
            return inv_freq, attention_factor
        ROPE_INIT_FUNCTIONS["default"] = _compute_default_rope_parameters
        print("Patched default via local classic impl")
    else:
        raise SystemExit("Cannot patch default rope")

sys.path.insert(0, "/work/ComfyUI/custom_nodes/TTS-Audio-Suite/engines/qwen3_tts/impl")
from qwen_tts import Qwen3TTSModel

model_dir = "/work/ComfyUI/models/TTS/qwen3_tts/Qwen3-TTS-12Hz-1.7B-Base"
ref_wav = "/work/ComfyUI/custom_nodes/TTS-Audio-Suite/voices_examples/female/female_01.wav"
with open("/work/ComfyUI/custom_nodes/TTS-Audio-Suite/voices_examples/female/female_01.reference.txt") as f:
    ref_text = f.read().strip()
text = "I missed you so much. Come closer."
out_path = "/work/ComfyUI/input/tts_qwen3_line.wav"

print("Loading...")
dtype = torch.bfloat16
model = Qwen3TTSModel.from_pretrained(
    model_dir,
    device_map="cuda:0",
    torch_dtype=dtype,
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
print(f"shape={wav.shape} sr={sr}")
peak = float(np.max(np.abs(wav)) + 1e-8)
wav_n = wav / peak * 0.95

# resample 16k
try:
    import librosa
    y16 = librosa.resample(wav_n, orig_sr=sr, target_sr=16000)
except Exception as e:
    print("librosa fail", e)
    n = int(len(wav_n) * 16000 / sr)
    y16 = np.interp(np.linspace(0,1,n,endpoint=False), np.linspace(0,1,len(wav_n),endpoint=False), wav_n).astype(np.float32)

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
