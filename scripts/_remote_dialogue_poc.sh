#!/bin/bash
set -e
LOG=/work/DIALOGUE_POC.log
exec > >(tee -a "$LOG") 2>&1
echo "[$(date +%H:%M:%S)] START dialogue PoC"

PY=/work/ai/venv/bin/python3
PIP=/work/ai/venv/bin/pip
CN=/work/ComfyUI/custom_nodes
COMFY=/work/ComfyUI

# --- Whisper path MuseTalk expects ---
WDIR="$CN/ComfyUI-MuseTalk-KJ/musetalk/whisper/checkpoints"
mkdir -p "$WDIR"
if [ ! -f "$WDIR/tiny.pt" ]; then
  if [ -f /work/ComfyUI/models/whisper/tiny.pt ]; then
    cp -f /work/ComfyUI/models/whisper/tiny.pt "$WDIR/tiny.pt"
    echo "copied whisper tiny.pt"
  else
    curl -L --http1.1 -o "$WDIR/tiny.pt" \
      "https://openaipublic.azureedge.net/main/whisper/models/65147644a518d12f04e32d6f3b26facc3f8dd46e5390956a9424a650c0ce22b9/tiny.pt"
  fi
fi
ls -lh "$WDIR/tiny.pt"

# --- SD1.5 VAE for MuseTalk ---
VAE=/work/ComfyUI/models/vae/sd-vae-ft-mse.safetensors
if [ ! -f "$VAE" ] || [ "$(stat -c%s "$VAE")" -lt 100000000 ]; then
  echo "DL sd-vae-ft-mse"
  HF_IP=$(getent ahostsv4 huggingface.co | awk '{print $1; exit}')
  curl -L --http1.1 --retry 5 -C - --resolve "huggingface.co:443:$HF_IP" \
    -o "${VAE}.part" \
    "https://huggingface.co/stabilityai/sd-vae-ft-mse-original/resolve/main/vae-ft-mse-840000-ema-pruned.safetensors" \
    || curl -L --http1.1 --retry 5 -C - -o "${VAE}.part" \
    "https://huggingface.co/stabilityai/sd-vae-ft-mse-original/resolve/main/vae-ft-mse-840000-ema-pruned.safetensors"
  mv "${VAE}.part" "$VAE"
fi
ls -lh "$VAE"

# --- Piper TTS node ---
if [ ! -d "$CN/ComfyUI-PiperTTS/.git" ]; then
  git clone --depth 1 https://github.com/yuvraj108c/ComfyUI-PiperTTS.git "$CN/ComfyUI-PiperTTS"
fi
$PIP install -r "$CN/ComfyUI-PiperTTS/requirements.txt" || $PIP install piper-tts || true

# Pre-download one English Piper voice offline via curl if possible
PVOICE=/work/ComfyUI/models/piper
mkdir -p "$PVOICE"
# common voice en_US-lessac-medium
VOICE_URL_BASE="https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium"
if [ ! -f "$PVOICE/en_US-lessac-medium.onnx" ]; then
  HF_IP=$(getent ahostsv4 huggingface.co | awk '{print $1; exit}')
  for f in en_US-lessac-medium.onnx en_US-lessac-medium.onnx.json; do
    echo "DL $f"
    curl -L --http1.1 --retry 5 -C - --resolve "huggingface.co:443:$HF_IP" \
      -o "$PVOICE/$f.part" "$VOICE_URL_BASE/$f" && mv "$PVOICE/$f.part" "$PVOICE/$f" || true
  done
fi
ls -lh "$PVOICE" || true

# --- Generate clean dialogue sample with edge-tts (local CLI, uses MS edge endpoint - fallback) ---
# Prefer piper if available
OUT_WAV=/work/ComfyUI/input/dialogue_test.wav
OUT_MP3=/work/ComfyUI/input/dialogue_test.mp3
TEXT='Hello. My name is Olga. How are you today?'

if command -v piper >/dev/null 2>&1 && [ -f "$PVOICE/en_US-lessac-medium.onnx" ]; then
  echo "$TEXT" | piper --model "$PVOICE/en_US-lessac-medium.onnx" --output_file "$OUT_WAV" && echo PIPER_OK
elif $PY -c "import piper" 2>/dev/null && [ -f "$PVOICE/en_US-lessac-medium.onnx" ]; then
  $PY - <<PY
from piper import PiperVoice
v=PiperVoice.load("$PVOICE/en_US-lessac-medium.onnx")
with open("$OUT_WAV","wb") as f:
    v.synthesize("$TEXT", f)
print("PIPER_PY_OK")
PY
else
  $PY -m edge_tts --voice en-US-AriaNeural --text "$TEXT" --write-media "$OUT_MP3"
  ffmpeg -y -i "$OUT_MP3" "$OUT_WAV" 2>/dev/null || cp "$OUT_MP3" /work/ComfyUI/input/dialogue_test.mp3
  echo EDGE_TTS_OK
fi
ls -lh /work/ComfyUI/input/dialogue_test.* 2>/dev/null

# --- Copy MuseTalk example workflow ---
mkdir -p /work/ComfyUI/user/default/workflows
cp -f "$CN/ComfyUI-MuseTalk-KJ/example_workflows/musetalk_vid2vid_example.json" \
  /work/ComfyUI/user/default/workflows/musetalk_dialogue_example.json

# TTS helper script for platform
cat > /work/scripts_tts_dialogue.sh <<'EOS'
#!/bin/bash
# Usage: bash /work/scripts_tts_dialogue.sh "Your text here" /work/ComfyUI/input/my_line.wav
set -e
TEXT=${1:-"Hello. How are you?"}
OUT=${2:-/work/ComfyUI/input/dialogue_line.wav}
VOICE=/work/ComfyUI/models/piper/en_US-lessac-medium.onnx
mkdir -p "$(dirname "$OUT")"
if [ -f "$VOICE" ] && python3 -c "import piper" 2>/dev/null; then
  python3 - <<PY
from piper import PiperVoice
v=PiperVoice.load("$VOICE")
with open("$OUT","wb") as f:
    v.synthesize("""$TEXT""", f)
print("wrote", "$OUT")
PY
else
  MP3="${OUT%.wav}.mp3"
  /work/ai/venv/bin/python3 -m edge_tts --voice en-US-AriaNeural --text "$TEXT" --write-media "$MP3"
  ffmpeg -y -i "$MP3" "$OUT"
  echo "wrote $OUT via edge-tts"
fi
EOS
chmod +x /work/scripts_tts_dialogue.sh

# Restart Comfy to load Piper
pkill -9 -f '/work/ComfyUI/main.py' || true
sleep 2
cd "$COMFY"
nohup $PY main.py --listen --port 8188 --enable-manager >/work/comfy_restart.log 2>&1 &
echo PID:$!
for i in $(seq 1 15); do
  sleep 3
  code=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8188/ || echo 000)
  echo try$i=$code
  [ "$code" = "200" ] && break
done

curl -s http://127.0.0.1:8188/object_info > /tmp/oi.json
$PY - <<'PY'
import json
d=json.load(open("/tmp/oi.json"))
for k in sorted(d):
    if any(x in k.lower() for x in ["piper","muse","whisper","loadaudio"]):
        print(k)
PY

echo DONE
