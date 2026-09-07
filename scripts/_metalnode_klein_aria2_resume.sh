#!/bin/bash
export PATH=/usr/bin:/bin:/usr/local/bin
cd /work/ComfyUI/models/diffusion_models
PART=flux-2-klein-9b-fp8.safetensors.part
DEST=flux-2-klein-9b-fp8.safetensors
URL=https://huggingface.co/titomatus0203/flux-2-klein-9b-fp8/resolve/main/flux-2-klein-9b-fp8.safetensors
EXPECT=9433061528

pkill -f "$PART" || true
pkill -f 'aria2c.*klein' || true
sleep 2

sz=0
if [ -f "$PART" ]; then sz=$(stat -c%s "$PART"); fi
if [ -f "$DEST" ]; then dsz=$(stat -c%s "$DEST"); else dsz=0; fi
echo "part=$sz dest=$dsz expect=$EXPECT"

if [ "$dsz" -ge "$EXPECT" ]; then
  echo ALREADY_DONE
  exit 0
fi
if [ "$sz" -ge "$EXPECT" ]; then
  mv -f "$PART" "$DEST"
  echo MOVED_COMPLETE
  exit 0
fi

# resume with fewer connections to reduce 403
nohup aria2c -c -x 4 -s 4 -k 1M --file-allocation=none \
  --timeout=60 --retry-wait=3 --max-tries=0 \
  --allow-overwrite=true --auto-file-renaming=false \
  --lowest-speed-limit=10K \
  -o "$PART" "$URL" > /work/dl_klein_aria.log 2>&1 &
echo ARIA:$!
sleep 10
sz2=$(stat -c%s "$PART")
echo "after10s=$sz2"
tail -15 /work/dl_klein_aria.log | tr -d '\r'
