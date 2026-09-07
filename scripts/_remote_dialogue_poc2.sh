#!/bin/bash
set -e
LOG=/work/DIALOGUE_POC.log
exec > >(tee -a "$LOG") 2>&1
echo "[$(date +%H:%M:%S)] CONTINUE"

PY=/work/ai/venv/bin/python3
PIP=/work/ai/venv/bin/pip
CN=/work/ComfyUI/custom_nodes

# GitHub resolve
GH_IP=$(getent ahostsv4 github.com | awk '{print $1; exit}')
echo GH_IP=$GH_IP
if [ -z "$GH_IP" ]; then
  GH_IP=$(curl -4 -s https://api.ipify.org >/dev/null; getent ahostsv4 github.com | awk '{print $1; exit}')
fi
# try multiple
for ip in $GH_IP 140.82.121.4 140.82.114.4; do
  echo "try clone with $ip"
  if [ ! -d "$CN/ComfyUI-PiperTTS/.git" ]; then
    git -c http.version=HTTP/1.1 clone --depth 1 \
      "https://github.com/yuvraj108c/ComfyUI-PiperTTS.git" "$CN/ComfyUI-PiperTTS" \
      && break || rm -rf "$CN/ComfyUI-PiperTTS"
    # alternate: curl zip
  fi
done

if [ ! -d "$CN/ComfyUI-PiperTTS/.git" ]; then
  echo "clone via zipball"
  HF_OR_GH=140.82.121.3
  mkdir -p /tmp/piper_zip
  curl -L --http1.1 --resolve "github.com:443:$GH_IP" --resolve "codeload.github.com:443:$(getent ahostsv4 codeload.github.com | awk '{print $1; exit}')" \
    -o /tmp/piper.zip "https://github.com/yuvraj108c/ComfyUI-PiperTTS/archive/refs/heads/master.zip" || \
  curl -L --http1.1 -o /tmp/piper.zip "https://codeload.github.com/yuvraj108c/ComfyUI-PiperTTS/zip/refs/heads/master"
  unzip -q /tmp/piper.zip -d /tmp/piper_zip
  mv /tmp/piper_zip/ComfyUI-PiperTTS-* "$CN/ComfyUI-PiperTTS"
fi

$PIP install -r "$CN/ComfyUI-PiperTTS/requirements.txt" 2>/dev/null || $PIP install piper-tts onnxruntime 2>/dev/null || true

# Piper voice
PVOICE=/work/ComfyUI/models/piper
mkdir -p "$PVOICE"
HF_IP=$(getent ahostsv4 huggingface.co | awk '{print $1; exit}')
BASE="https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium"
for f in en_US-lessac-medium.onnx en_US-lessac-medium.onnx.json; do
  if [ ! -f "$PVOICE/$f" ] || [ "$(stat -c%s "$PVOICE/$f" 2>/dev/null || echo 0)" -lt 1000 ]; then
    curl -L --http1.1 --retry 5 -C - --resolve "huggingface.co:443:$HF_IP" \
      -o "$PVOICE/$f.part" "$BASE/$f" && mv "$PVOICE/$f.part" "$PVOICE/$f"
  fi
done
ls -lh "$PVOICE"

# dialogue wav via edge-tts (reliable enough for PoC)
TEXT='Hello. My name is Olga. How are you today?'
OUT_WAV=/work/ComfyUI/input/dialogue_test.wav
OUT_MP3=/work/ComfyUI/input/dialogue_test.mp3
$PY -m edge_tts --voice en-US-AriaNeural --text "$TEXT" --write-media "$OUT_MP3"
ffmpeg -y -i "$OUT_MP3" -ar 16000 -ac 1 "$OUT_WAV"
ls -lh "$OUT_WAV" "$OUT_MP3"

# TTS script
mkdir -p /work
cat > /work/scripts_tts_dialogue.sh <<'EOS'
#!/bin/bash
set -e
TEXT=${1:-"Hello. How are you?"}
OUT=${2:-/work/ComfyUI/input/dialogue_line.wav}
MP3="${OUT%.wav}.mp3"
/work/ai/venv/bin/python3 -m edge_tts --voice en-US-AriaNeural --text "$TEXT" --write-media "$MP3"
ffmpeg -y -i "$MP3" -ar 16000 -ac 1 "$OUT"
echo "OK $OUT"
EOS
chmod +x /work/scripts_tts_dialogue.sh

cp -f "$CN/ComfyUI-MuseTalk-KJ/example_workflows/musetalk_vid2vid_example.json" \
  /work/ComfyUI/user/default/workflows/musetalk_dialogue_example.json

# ensure whisper + vae
ls -lh /work/ComfyUI/custom_nodes/ComfyUI-MuseTalk-KJ/musetalk/whisper/checkpoints/tiny.pt
ls -lh /work/ComfyUI/models/vae/sd-vae-ft-mse.safetensors

pkill -9 -f '/work/ComfyUI/main.py' || true
sleep 2
cd /work/ComfyUI
nohup $PY main.py --listen --port 8188 --enable-manager >/work/comfy_restart.log 2>&1 &
for i in $(seq 1 12); do
  sleep 3
  code=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8188/ || echo 000)
  echo try$i=$code
  [ "$code" = "200" ] && break
done

curl -s http://127.0.0.1:8188/object_info > /tmp/oi.json
$PY -c "import json;d=json.load(open('/tmp/oi.json'));
print('muse_talk_sampler', 'muse_talk_sampler' in d);
print('whisper', 'whisper_to_features' in d);
print('piper', [k for k in d if 'piper' in k.lower() or 'Piper' in k]);
print('LoadAudio', 'LoadAudio' in d)"

echo DONE
