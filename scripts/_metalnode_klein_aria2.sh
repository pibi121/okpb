#!/bin/bash
export PATH=/usr/bin:/bin:/usr/local/bin
set -x
PART=/work/ComfyUI/models/diffusion_models/flux-2-klein-9b-fp8.safetensors.part
DEST=/work/ComfyUI/models/diffusion_models/flux-2-klein-9b-fp8.safetensors
URL=https://huggingface.co/titomatus0203/flux-2-klein-9b-fp8/resolve/main/flux-2-klein-9b-fp8.safetensors
URL2=https://hf-mirror.com/titomatus0203/flux-2-klein-9b-fp8/resolve/main/flux-2-klein-9b-fp8.safetensors

# install aria2 if missing
if ! command -v aria2c >/dev/null 2>&1; then
  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq aria2
fi
command -v aria2c

# stop slow wget/curl
pkill -f flux-2-klein-9b-fp8.safetensors.part || true
pkill -f 'aria2c.*flux-2-klein' || true
sleep 2

# aria2 resume multi-connection into .part then rename when done
# use --auto-file-renaming=false and explicit out
cd /work/ComfyUI/models/diffusion_models
# if partial exists, aria2 can continue with -c
nohup aria2c -c -x 16 -s 16 -k 1M --file-allocation=none \
  --timeout=60 --retry-wait=2 --max-tries=0 \
  --allow-overwrite=true --auto-file-renaming=false \
  -o flux-2-klein-9b-fp8.safetensors.part \
  "$URL" > /work/dl_klein_aria.log 2>&1 &
echo ARIA_PID:$!
sleep 5
ls -lh flux-2-klein-9b-fp8.safetensors.part
tail -20 /work/dl_klein_aria.log
