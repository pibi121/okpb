#!/bin/bash
export PATH=/usr/bin:/bin:/usr/local/bin:/work/ai/venv/bin
set -e
DEST=/work/ComfyUI/models/diffusion_models/flux-2-klein-9b-fp8.safetensors
PART=${DEST}.part
URL=https://huggingface.co/titomatus0203/flux-2-klein-9b-fp8/resolve/main/flux-2-klein-9b-fp8.safetensors
EXPECT_SHA=865ba09f5b4c3cbd3468a4bd3acb9fcb2f8740c54317482f0bcd4ed1d3655cee
EXPECT_SIZE=9433061528
LOG=/work/REDOWNLOAD_KLEIN.log

: > "$LOG"
log(){ echo "[$(date +%H:%M:%S)] $*" | tee -a "$LOG"; }

pkill -f 'aria2c.*flux-2-klein' || true
pkill -f 'wget.*flux-2-klein' || true
sleep 1

# remove corrupt file
if [ -f "$DEST" ]; then
  cur=$(sha256sum "$DEST" | awk '{print $1}')
  log "current_sha=$cur"
  if [ "$cur" = "$EXPECT_SHA" ]; then
    log "ALREADY_GOOD"
    exit 0
  fi
  log "CORRUPT_REMOVE"
  rm -f "$DEST" "$PART" "${DEST}.aria2" "${PART}.aria2"
fi

rm -f "$PART" "${PART}.aria2"
cd "$(dirname "$DEST")"

log "START_ARIA2"
aria2c -c -x 8 -s 8 -k 1M --file-allocation=none \
  --timeout=60 --retry-wait=3 --max-tries=0 \
  --allow-overwrite=true --auto-file-renaming=false \
  --check-integrity=true \
  -o "$(basename "$PART")" "$URL" >> "$LOG" 2>&1

sz=$(stat -c%s "$PART")
log "downloaded_size=$sz"
if [ "$sz" -ne "$EXPECT_SIZE" ]; then
  log "SIZE_MISMATCH"
  exit 1
fi
sha=$(sha256sum "$PART" | awk '{print $1}')
log "sha=$sha"
if [ "$sha" != "$EXPECT_SHA" ]; then
  log "SHA_MISMATCH"
  exit 2
fi
mv -f "$PART" "$DEST"
cd /work/ComfyUI/models/diffusion_models
rm -f flux-2-klein-9b.safetensors
ln -sf flux-2-klein-9b-fp8.safetensors flux-2-klein-9b.safetensors
log "READY"
sha256sum "$DEST" | tee -a "$LOG"
