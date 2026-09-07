#!/bin/bash
export PATH=/usr/bin:/bin:/usr/local/bin
DEST=/work/ComfyUI/models/diffusion_models/flux-2-klein-9b-fp8.safetensors
PART=${DEST}.part
URL=https://huggingface.co/titomatus0203/flux-2-klein-9b-fp8/resolve/main/flux-2-klein-9b-fp8.safetensors
EXPECT_SHA=865ba09f5b4c3cbd3468a4bd3acb9fcb2f8740c54317482f0bcd4ed1d3655cee
EXPECT_SIZE=9433061528
LOG=/work/REDOWNLOAD_KLEIN_WGET.log

: > "$LOG"
log(){ echo "[$(date +%H:%M:%S)] $*" | tee -a "$LOG"; }

pkill -f 'aria2c.*flux-2-klein' || true
pkill -f 'hf_redownload_klein' || true
pkill -f 'wget.*flux-2-klein-9b-fp8' || true
sleep 2

if [ -f "$DEST" ]; then
  cur=$(sha256sum "$DEST" | awk '{print $1}')
  log "existing_sha=$cur"
  if [ "$cur" = "$EXPECT_SHA" ]; then
    log "ALREADY_GOOD"
    exit 0
  fi
  log "CORRUPT_REMOVE_DEST"
  rm -f "$DEST"
fi

# Fresh download — previous aria2 multi-conn left wrong bytes at full size
rm -f "$PART" "${DEST}.aria2" "${PART}.aria2"

log "WGET_START"
# single connection avoids multi-range 403 corruption
wget -4 -c --timeout=60 --tries=0 --progress=dot:giga \
  -O "$PART" "$URL" >> "$LOG" 2>&1
rc=$?
log "wget_exit=$rc"

if [ ! -f "$PART" ]; then
  log "NO_PART"
  exit 1
fi

sz=$(stat -c%s "$PART")
log "size=$sz expect=$EXPECT_SIZE"
if [ "$sz" -ne "$EXPECT_SIZE" ]; then
  log "SIZE_MISMATCH"
  exit 2
fi

log "SHA_CALC"
sha=$(sha256sum "$PART" | awk '{print $1}')
log "sha=$sha"
if [ "$sha" != "$EXPECT_SHA" ]; then
  log "SHA_MISMATCH_DELETE"
  rm -f "$PART"
  exit 3
fi

mv -f "$PART" "$DEST"
cd /work/ComfyUI/models/diffusion_models
rm -f flux-2-klein-9b.safetensors
ln -sf flux-2-klein-9b-fp8.safetensors flux-2-klein-9b.safetensors
log "READY"
sha256sum "$DEST" | tee -a "$LOG"
