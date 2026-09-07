#!/bin/bash
set -e
# Clean single Comfy + Piper voice path + ensure controlnet aux for MuseTalk masks
PY=/work/ai/venv/bin/python3
CN=/work/ComfyUI/custom_nodes

# Piper models where node expects them
mkdir -p /work/ComfyUI/models/piper_tts
cp -n /work/ComfyUI/models/piper/en_US-lessac-medium.onnx /work/ComfyUI/models/piper_tts/en_US-lessac-medium.onnx 2>/dev/null || true
cp -n /work/ComfyUI/models/piper/en_US-lessac-medium.onnx.json /work/ComfyUI/models/piper_tts/en_US-lessac-medium.onnx.json 2>/dev/null || true
# node looks for voice-quality.onnx like en_US-lessac-medium.onnx - good
ls -lh /work/ComfyUI/models/piper_tts/

# controlnet aux for DWPreprocessor in example
if [ ! -d "$CN/comfyui_controlnet_aux/.git" ] && [ ! -d "$CN/comfyui_controlnet_aux" ]; then
  GH_IP=$(getent ahostsv4 github.com | awk '{print $1; exit}')
  git clone --depth 1 https://github.com/Fannovel16/comfyui_controlnet_aux.git "$CN/comfyui_controlnet_aux" || \
  (curl -L --http1.1 -o /tmp/cna.zip "https://codeload.github.com/Fannovel16/comfyui_controlnet_aux/zip/refs/heads/main" && unzip -q /tmp/cna.zip -d /tmp && mv /tmp/comfyui_controlnet_aux-* "$CN/comfyui_controlnet_aux")
  $PY -m pip install -r "$CN/comfyui_controlnet_aux/requirements.txt" || true
fi
ls "$CN" | grep -iE 'controlnet_aux|piper|muse'

# kill ALL comfy
pkill -9 -f 'main.py --listen' || true
pkill -9 -f '/work/ComfyUI/main.py' || true
sleep 3
fuser -k 8188/tcp 2>/dev/null || true
sleep 2

cd /work/ComfyUI
nohup $PY main.py --listen --port 8188 --enable-manager >/work/comfy_restart.log 2>&1 &
echo NEW:$!
for i in $(seq 1 15); do
  sleep 3
  code=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8188/ || echo 000)
  echo try$i=$code
  [ "$code" = "200" ] && break
done
pgrep -af 'main.py --listen' | head -5

curl -s http://127.0.0.1:8188/object_info > /tmp/oi.json
$PY - <<'PY'
import json
d=json.load(open("/tmp/oi.json"))
for name in ["PiperTTS","muse_talk_sampler","whisper_to_features","LoadAudio","DWPreprocessor","VHS_LoadVideo","VAELoader"]:
    print(name, name in d)
# DW might be named differently
print("DW*", [k for k in d if "DW" in k or "dwpose" in k.lower()][:10])
PY
grep -E 'PiperTTS|MuseTalk|controlnet_aux|Error importing|Starting server' /work/comfy_restart.log | tail -30
echo DONE
