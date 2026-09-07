#!/bin/bash
export PATH=/usr/bin:/bin:/usr/local/bin
DEST=/work/ComfyUI/models/diffusion_models/flux-2-klein-9b-fp8.safetensors
PART=${DEST}.part
EXPECT_SHA=865ba09f5b4c3cbd3468a4bd3acb9fcb2f8740c54317482f0bcd4ed1d3655cee
EXPECT_SIZE=9433061528
LOG=/work/REDOWNLOAD_KLEIN_CURL.log
: > "$LOG"
log(){ echo "[$(date +%H:%M:%S)] $*" | tee -a "$LOG"; }

pkill -f 'flux-2-klein-9b-fp8' || true
sleep 2

if [ -f "$DEST" ]; then
  cur=$(sha256sum "$DEST" | awk '{print $1}')
  log "existing=$cur"
  if [ "$cur" = "$EXPECT_SHA" ]; then
    log "ALREADY_GOOD"; exit 0
  fi
  rm -f "$DEST"
fi
rm -f "$PART" "${PART}.aria2" "${DEST}.aria2"

# Resolve via getent (wget DNS is broken on this host)
HF_IP=$(getent ahostsv4 huggingface.co | awk '{print $1; exit}')
CDN_IP=$(getent ahostsv4 us.aws.cdn.hf.co | awk '{print $1; exit}')
log "HF_IP=$HF_IP CDN_IP=$CDN_IP"

# Follow redirects manually with curl --resolve
URL="https://huggingface.co/titomatus0203/flux-2-klein-9b-fp8/resolve/main/flux-2-klein-9b-fp8.safetensors"

log "CURL_START"
# Use curl with forced resolve; allow redirects; resume
RESOLVE_ARGS=(
  --resolve "huggingface.co:443:${HF_IP}"
)
if [ -n "$CDN_IP" ]; then
  RESOLVE_ARGS+=(--resolve "us.aws.cdn.hf.co:443:${CDN_IP}")
  # also common cdn hosts
  RESOLVE_ARGS+=(--resolve "cas-bridge.xethub.hf.co:443:${CDN_IP}")
fi

# First get final redirect URL
FINAL=$(curl -4 -sI -L --max-redirs 10 "${RESOLVE_ARGS[@]}" "$URL" | tr -d '\r' | awk 'tolower($1)=="location:"{print $2}' | tail -1)
log "FINAL=$FINAL"

# Download with resume
curl -4 -L --retry 30 --retry-all-errors --retry-delay 2 \
  -C - \
  "${RESOLVE_ARGS[@]}" \
  --connect-timeout 30 \
  -o "$PART" \
  "$URL" >> "$LOG" 2>&1
rc=$?
log "curl_exit=$rc"

sz=$(stat -c%s "$PART" 2>/dev/null || echo 0)
log "size=$sz"
if [ "$sz" -ne "$EXPECT_SIZE" ]; then
  log "SIZE_MISMATCH"
  exit 2
fi
sha=$(sha256sum "$PART" | awk '{print $1}')
log "sha=$sha"
if [ "$sha" != "$EXPECT_SHA" ]; then
  log "SHA_MISMATCH"
  rm -f "$PART"
  exit 3
fi
mv -f "$PART" "$DEST"
cd /work/ComfyUI/models/diffusion_models
rm -f flux-2-klein-9b.safetensors
ln -sf flux-2-klein-9b-fp8.safetensors flux-2-klein-9b.safetensors
log "READY"
sha256sum "$DEST" | tee -a "$LOG"
