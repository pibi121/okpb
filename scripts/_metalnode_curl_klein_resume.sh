#!/bin/bash
export PATH=/usr/bin:/bin:/usr/local/bin
DEST=/work/ComfyUI/models/diffusion_models/flux-2-klein-9b-fp8.safetensors
PART=${DEST}.part
EXPECT_SHA=865ba09f5b4c3cbd3468a4bd3acb9fcb2f8740c54317482f0bcd4ed1d3655cee
EXPECT_SIZE=9433061528
LOG=/work/REDOWNLOAD_KLEIN_CURL.log
log(){ echo "[$(date +%H:%M:%S)] $*" | tee -a "$LOG"; }

# Keep partial file; only kill curl for this file
pkill -f 'curl.*flux-2-klein-9b-fp8' || true
sleep 2

if [ -f "$DEST" ]; then
  cur=$(sha256sum "$DEST" | awk '{print $1}')
  if [ "$cur" = "$EXPECT_SHA" ]; then
    log "ALREADY_GOOD"; exit 0
  fi
  rm -f "$DEST"
fi

HF_IP=$(getent ahostsv4 huggingface.co | awk '{print $1; exit}')
CDN_IP=$(getent ahostsv4 us.aws.cdn.hf.co | awk '{print $1; exit}')
CAS_IP=$(getent ahostsv4 cas-bridge.xethub.hf.co | awk '{print $1; exit}')
# fallbacks
[ -z "$CDN_IP" ] && CDN_IP="$CAS_IP"
[ -z "$CAS_IP" ] && CAS_IP="$CDN_IP"
log "RESUME HF=$HF_IP CDN=$CDN_IP CAS=$CAS_IP part=$(stat -c%s "$PART" 2>/dev/null || echo 0)"

URL="https://huggingface.co/titomatus0203/flux-2-klein-9b-fp8/resolve/main/flux-2-klein-9b-fp8.safetensors"
RESOLVE_ARGS=( --resolve "huggingface.co:443:${HF_IP}" )
[ -n "$CDN_IP" ] && RESOLVE_ARGS+=(--resolve "us.aws.cdn.hf.co:443:${CDN_IP}")
[ -n "$CAS_IP" ] && RESOLVE_ARGS+=(--resolve "cas-bridge.xethub.hf.co:443:${CAS_IP}")
# also try common cdn hostnames that appear in redirects
for h in cdn-lfs.huggingface.co cdn-lfs-us-1.huggingface.co; do
  ip=$(getent ahostsv4 "$h" | awk '{print $1; exit}')
  [ -n "$ip" ] && RESOLVE_ARGS+=(--resolve "${h}:443:${ip}")
done

log "CURL_RESUME_START"
curl -4 -L --retry 50 --retry-all-errors --retry-delay 2 \
  -C - \
  "${RESOLVE_ARGS[@]}" \
  --connect-timeout 30 \
  --speed-time 120 --speed-limit 50000 \
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
