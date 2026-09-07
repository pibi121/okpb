#!/bin/bash
export PATH=/usr/bin:/bin:/usr/local/bin
DEST=/work/ComfyUI/models/diffusion_models/flux-2-klein-9b-fp8.safetensors
PART=${DEST}.part
EXPECT_SHA=865ba09f5b4c3cbd3468a4bd3acb9fcb2f8740c54317482f0bcd4ed1d3655cee
EXPECT_SIZE=9433061528
LOG=/work/REDOWNLOAD_KLEIN_CURL.log
log(){ echo "[$(date +%H:%M:%S)] $*" | tee -a "$LOG"; }

pkill -f 'curl.*flux-2-klein' || true
sleep 2

grep -vE 'huggingface|hf\.co|xethub' /etc/hosts > /tmp/hosts.clean || true
cp /tmp/hosts.clean /etc/hosts

if [ -f "$DEST" ]; then
  cur=$(sha256sum "$DEST" | awk '{print $1}')
  if [ "$cur" = "$EXPECT_SHA" ]; then log "ALREADY_GOOD"; exit 0; fi
  rm -f "$DEST"
fi

HF_IP=$(getent ahostsv4 huggingface.co | awk '{print $1; exit}')
CDN_IP=$(getent ahostsv4 us.aws.cdn.hf.co | awk '{print $1; exit}')
CAS_IP=$(getent ahostsv4 cas-bridge.xethub.hf.co | awk '{print $1; exit}')
log "RESUME4 HF=$HF_IP CDN=$CDN_IP CAS=$CAS_IP part=$(stat -c%s "$PART" 2>/dev/null || echo 0)"

URL="https://huggingface.co/titomatus0203/flux-2-klein-9b-fp8/resolve/main/flux-2-klein-9b-fp8.safetensors"
RESOLVE_ARGS=(--resolve "huggingface.co:443:${HF_IP}")
[ -n "$CDN_IP" ] && RESOLVE_ARGS+=(--resolve "us.aws.cdn.hf.co:443:${CDN_IP}")
[ -n "$CAS_IP" ] && RESOLVE_ARGS+=(--resolve "cas-bridge.xethub.hf.co:443:${CAS_IP}")

log "CURL_RESUME4_START"
# Use --fail-early off; long retries; abort if speed < 50KB/s for 3 min
curl -4 -L --retry 100 --retry-all-errors --retry-delay 5 \
  -C - \
  "${RESOLVE_ARGS[@]}" \
  --connect-timeout 30 \
  --speed-time 180 --speed-limit 50000 \
  -o "$PART" \
  "$URL" >> "$LOG" 2>&1
rc=$?
log "curl_exit4=$rc"

sz=$(stat -c%s "$PART" 2>/dev/null || echo 0)
log "size4=$sz"
if [ "$sz" -ne "$EXPECT_SIZE" ]; then log "SIZE_MISMATCH4"; exit 2; fi
sha=$(sha256sum "$PART" | awk '{print $1}')
log "sha4=$sha"
if [ "$sha" != "$EXPECT_SHA" ]; then log "SHA_MISMATCH4"; rm -f "$PART"; exit 3; fi
mv -f "$PART" "$DEST"
cd /work/ComfyUI/models/diffusion_models
rm -f flux-2-klein-9b.safetensors
ln -sf flux-2-klein-9b-fp8.safetensors flux-2-klein-9b.safetensors
log "READY"
sha256sum "$DEST" | tee -a "$LOG"
