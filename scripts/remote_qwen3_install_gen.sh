#!/bin/bash
# Install Qwen3-TTS deps (minimal) + download Base 1.7B + smoke generate
set -euo pipefail

PY=/work/ai/venv/bin/python
PIP=/work/ai/venv/bin/pip
SUITE=/work/ComfyUI/custom_nodes/TTS-Audio-Suite
MODEL_DIR=/work/ComfyUI/models/TTS/qwen3_tts
OUT_WAV=/work/ComfyUI/input/tts_qwen3_line.wav
REF_WAV="$SUITE/voices_examples/female/female_01.wav"
REF_TXT="$SUITE/voices_examples/female/female_01.reference.txt"
TEXT='I missed you so much. Come closer.'
MODEL_ID=Qwen/Qwen3-TTS-12Hz-1.7B-Base
LOCAL_MODEL="$MODEL_DIR/Qwen3-TTS-12Hz-1.7B-Base"
LOG=/tmp/qwen3_tts_install.log

exec > >(tee -a "$LOG") 2>&1

echo "=== $(date -Is) Qwen3-TTS install start ==="

mkdir -p "$MODEL_DIR"

# Minimal deps for bundled qwen_tts (avoid full Suite install.py which pulls all engines)
echo "=== pip deps ==="
$PIP install -q --upgrade 'huggingface_hub>=0.26' sox soundfile einops
# qwen3-tts may need onnxruntime / others - probe import first
$PY - <<'PY' || true
import sys
sys.path.insert(0, "/work/ComfyUI/custom_nodes/TTS-Audio-Suite/engines/qwen3_tts/impl")
try:
    from qwen_tts import Qwen3TTSModel
    print("bundled qwen_tts import OK")
except Exception as e:
    print("import fail:", e)
PY

# Check optional deps from Suite engine requirements if present
REQ="$SUITE/engines/qwen3_tts/requirements.txt"
if [ -f "$REQ" ]; then
  echo "=== engine requirements.txt ==="
  cat "$REQ"
  $PIP install -q -r "$REQ" || echo "WARN: some engine reqs failed"
fi

# Also check impl pyproject / setup
if [ -f "$SUITE/engines/qwen3_tts/impl/pyproject.toml" ]; then
  echo "=== impl pyproject ==="
  head -80 "$SUITE/engines/qwen3_tts/impl/pyproject.toml"
fi

echo "=== download model $MODEL_ID ==="
$PY - <<PY
from huggingface_hub import snapshot_download
import os
local = r"$LOCAL_MODEL"
os.makedirs(local, exist_ok=True)
# Skip if already complete-ish
need = ["config.json", "model.safetensors", "tokenizer_config.json"]
if all(os.path.exists(os.path.join(local, f)) for f in need):
    print("Model already present:", local)
else:
    path = snapshot_download(
        repo_id="$MODEL_ID",
        local_dir=local,
        local_dir_use_symlinks=False,
    )
    print("Downloaded to", path)
print("Listing:")
for root, dirs, files in os.walk(local):
    for f in files:
        p = os.path.join(root, f)
        print(f"  {os.path.relpath(p, local)}  {os.path.getsize(p)}")
PY

echo "=== generate sample ==="
$PY - <<'PY'
import sys, os, wave, struct
import numpy as np
sys.path.insert(0, "/work/ComfyUI/custom_nodes/TTS-Audio-Suite/engines/qwen3_tts/impl")
from qwen_tts import Qwen3TTSModel

model_dir = "/work/ComfyUI/models/TTS/qwen3_tts/Qwen3-TTS-12Hz-1.7B-Base"
ref_wav = "/work/ComfyUI/custom_nodes/TTS-Audio-Suite/voices_examples/female/female_01.wav"
with open("/work/ComfyUI/custom_nodes/TTS-Audio-Suite/voices_examples/female/female_01.reference.txt") as f:
    ref_text = f.read().strip()
text = "I missed you so much. Come closer."
out_path = "/work/ComfyUI/input/tts_qwen3_line.wav"
raw_path = "/tmp/tts_qwen3_raw.wav"

print("Loading model from", model_dir)
# Prefer bfloat16 on 5090
import torch
dtype = torch.bfloat16 if torch.cuda.is_available() else torch.float32
model = Qwen3TTSModel.from_pretrained(
    model_dir,
    device_map="cuda:0",
    dtype=dtype,
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
print(f"Got wav shape={wav.shape} sr={sr} min={wav.min():.3f} max={wav.max():.3f}")

# Save raw at native SR
peak = np.max(np.abs(wav)) + 1e-8
wav_n = wav / peak * 0.95
pcm = (wav_n * 32767.0).astype(np.int16)

def write_wav(path, pcm16, rate):
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(pcm16.tobytes())

write_wav(raw_path, pcm, int(sr))
print("Wrote raw", raw_path)

# Resample to 16k mono with scipy or librosa or ffmpeg
target_sr = 16000
try:
    import librosa
    y16 = librosa.resample(wav_n, orig_sr=sr, target_sr=target_sr)
except Exception as e:
    print("librosa resample fail", e)
    # linear resample fallback
    n = int(len(wav_n) * target_sr / sr)
    x_old = np.linspace(0, 1, num=len(wav_n), endpoint=False)
    x_new = np.linspace(0, 1, num=n, endpoint=False)
    y16 = np.interp(x_new, x_old, wav_n).astype(np.float32)

pcm16 = (np.clip(y16, -1, 1) * 32767.0).astype(np.int16)
write_wav(out_path, pcm16, target_sr)
dur = len(pcm16) / target_sr
print(f"Wrote {out_path} duration={dur:.2f}s samples={len(pcm16)} size={os.path.getsize(out_path)}")

# free VRAM
del model
torch.cuda.empty_cache()
print("DONE")
PY

echo "=== verify ==="
ls -la "$OUT_WAV"
file "$OUT_WAV"
ffprobe -hide_banner "$OUT_WAV" 2>&1 | head -20 || true
echo "=== $(date -Is) done ==="
