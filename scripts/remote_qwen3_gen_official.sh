#!/bin/bash
set -euo pipefail
export PYTHONUNBUFFERED=1
export TORCHDYNAMO_DISABLE=1

# sox optional but recommended by qwen-tts
apt-get install -y -qq sox 2>/dev/null || true

PY=/work/ai/venv/bin/python
OUT=/work/ComfyUI/input/tts_qwen3_line.wav
MODEL=/work/ComfyUI/models/TTS/qwen3_tts/Qwen3-TTS-12Hz-1.7B-Base
REF=/work/ComfyUI/custom_nodes/TTS-Audio-Suite/voices_examples/female/female_01.wav
REF_TXT=/work/ComfyUI/custom_nodes/TTS-Audio-Suite/voices_examples/female/female_01.reference.txt
SCRIPT=/work/scripts/qwen3_tts_generate.py

mkdir -p /work/scripts

cat > "$SCRIPT" <<'PY'
#!/usr/bin/env python3
"""Generate MuseTalk-ready 16k mono WAV via official qwen-tts (Base voice clone)."""
from __future__ import annotations
import argparse, os, sys, wave
import numpy as np
import torch

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="/work/ComfyUI/models/TTS/qwen3_tts/Qwen3-TTS-12Hz-1.7B-Base")
    ap.add_argument("--text", default="I missed you so much. Come closer.")
    ap.add_argument("--ref-audio", default="/work/ComfyUI/custom_nodes/TTS-Audio-Suite/voices_examples/female/female_01.wav")
    ap.add_argument("--ref-text", default=None)
    ap.add_argument("--out", default="/work/ComfyUI/input/tts_qwen3_line.wav")
    ap.add_argument("--language", default="English")
    args = ap.parse_args()

    ref_text = args.ref_text
    if ref_text is None:
        side = os.path.splitext(args.ref_audio)[0] + ".reference.txt"
        if os.path.isfile(side):
            ref_text = open(side, encoding="utf-8").read().strip()
        else:
            raise SystemExit(f"Need --ref-text or {side}")

    # Import official package first so it can patch transformers ROPE
    from qwen_tts import Qwen3TTSModel
    from transformers.modeling_rope_utils import ROPE_INIT_FUNCTIONS
    print("ROPE has default:", "default" in ROPE_INIT_FUNCTIONS, flush=True)

    print("Loading", args.model, flush=True)
    model = Qwen3TTSModel.from_pretrained(
        args.model,
        device_map="cuda:0",
        dtype=torch.bfloat16,
        attn_implementation="sdpa",
    )
    print("Generating...", flush=True)
    wavs, sr = model.generate_voice_clone(
        text=args.text,
        language=args.language,
        ref_audio=args.ref_audio,
        ref_text=ref_text,
    )
    wav = np.asarray(wavs[0], dtype=np.float32)
    print(f"native shape={wav.shape} sr={sr}", flush=True)
    peak = float(np.max(np.abs(wav)) + 1e-8)
    wav_n = (wav / peak * 0.95).astype(np.float32)

    import librosa
    y16 = librosa.resample(wav_n, orig_sr=int(sr), target_sr=16000)
    pcm = (np.clip(y16, -1.0, 1.0) * 32767.0).astype(np.int16)
    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    with wave.open(args.out, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(16000)
        w.writeframes(pcm.tobytes())
    print(f"Wrote {args.out} dur={len(pcm)/16000:.2f}s bytes={os.path.getsize(args.out)}", flush=True)
    del model
    torch.cuda.empty_cache()

if __name__ == "__main__":
    main()
PY
chmod +x "$SCRIPT"

echo "=== run generate ==="
$PY "$SCRIPT" \
  --model "$MODEL" \
  --ref-audio "$REF" \
  --ref-text "$(cat "$REF_TXT")" \
  --out "$OUT" \
  --text "I missed you so much. Come closer."

echo "=== verify ==="
ls -la "$OUT"
file "$OUT"
ffprobe -hide_banner "$OUT" 2>&1 | head -25
