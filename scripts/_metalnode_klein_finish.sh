#!/bin/bash
export PATH=/usr/bin:/bin:/usr/local/bin
cd /work/ComfyUI/models/diffusion_models
DEST=flux-2-klein-9b-fp8.safetensors
PART=flux-2-klein-9b-fp8.safetensors.part
URL=https://huggingface.co/titomatus0203/flux-2-klein-9b-fp8/resolve/main/flux-2-klein-9b-fp8.safetensors
EXPECT=9433061528

pkill -f 'aria2c.*flux-2-klein' || true
pkill -f 'wget.*flux-2-klein' || true
sleep 2

# Prefer continuing the larger partial
dsz=0; psz=0
[ -f "$DEST" ] && dsz=$(stat -c%s "$DEST")
[ -f "$PART" ] && psz=$(stat -c%s "$PART")
echo "before dest=$dsz part=$psz"

if [ "$dsz" -ge "$EXPECT" ]; then
  echo DONE
  rm -f "$PART" "${DEST}.aria2" "${PART}.aria2"
  exit 0
fi

# Use the larger of the two as continue base
if [ "$psz" -gt "$dsz" ]; then
  mv -f "$PART" "$DEST"
  echo "promoted part->$DEST"
fi
rm -f "$PART" "${PART}.aria2"

# Continue into DEST (final name)
nohup aria2c -c -x 8 -s 8 -k 1M --file-allocation=none \
  --timeout=60 --retry-wait=3 --max-tries=0 \
  --allow-overwrite=true --auto-file-renaming=false \
  --lowest-speed-limit=5K \
  -o "$DEST" "$URL" > /work/dl_klein_aria.log 2>&1 &
echo ARIA:$!
sleep 8
ls -lh "$DEST"
tail -c 300 /work/dl_klein_aria.log | tr -d '\r'; echo
