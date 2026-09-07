#!/bin/bash
# Download Qwen/Qwen3-8B via curl --resolve (huggingface_hub often hits Network unreachable)
export PATH=/usr/bin:/bin:/usr/local/bin
set -uo pipefail
LOG=/work/loras_out/olh_person_klein_train.log
TE_DIR=/work/train/models/qwen3-8b
mkdir -p "$TE_DIR"
log(){ echo "[$(date +%H:%M:%S)] $*" | tee -a "$LOG"; }

# Kill stuck hub download
pkill -f 'dl_qwen3_8b.sh' 2>/dev/null || true
pkill -f 'snapshot_download' 2>/dev/null || true
pkill -f 'huggingface_hub' 2>/dev/null || true
sleep 1

# Clean poisoned hosts (empty hf.co lines break SSL)
grep -vE 'huggingface|hf\.co|xethub|pypi|pythonhosted' /etc/hosts > /tmp/hosts.clean || true
cp /tmp/hosts.clean /etc/hosts

resolve_ips() {
  HF_IP=$(getent ahostsv4 huggingface.co | awk '{print $1; exit}')
  CDN_IP=$(getent ahostsv4 us.aws.cdn.hf.co | awk '{print $1; exit}')
  CAS_IP=$(getent ahostsv4 cas-bridge.xethub.hf.co | awk '{print $1; exit}')
  [ -z "${HF_IP:-}" ] && HF_IP=143.204.238.110
  [ -z "${CDN_IP:-}" ] && CDN_IP=35.181.67.163
  [ -z "${CAS_IP:-}" ] && CAS_IP=143.204.238.79
  if [ -z "$HF_IP" ] || [ -z "$CDN_IP" ]; then
    log "BAD_DNS HF='$HF_IP' CDN='$CDN_IP'"
    return 1
  fi
  RESOLVE=(
    --resolve "huggingface.co:443:${HF_IP}"
    --resolve "hf.co:443:${HF_IP}"
    --resolve "us.aws.cdn.hf.co:443:${CDN_IP}"
    --resolve "cas-bridge.xethub.hf.co:443:${CAS_IP}"
  )
  log "DNS HF=$HF_IP CDN=$CDN_IP CAS=$CAS_IP"
}

curl_get() {
  local url="$1" out="$2"
  resolve_ips || return 9
  curl -4 -L --retry 80 --retry-all-errors --retry-delay 3 -C - \
    "${RESOLVE[@]}" \
    --connect-timeout 30 \
    -o "$out" "$url"
}

BASE="https://huggingface.co/Qwen/Qwen3-8B/resolve/main"
FILES=(
  "config.json"
  "generation_config.json"
  "tokenizer.json"
  "tokenizer_config.json"
  "vocab.json"
  "merges.txt"
  "model.safetensors.index.json"
  "model-00001-of-00005.safetensors"
  "model-00002-of-00005.safetensors"
  "model-00003-of-00005.safetensors"
  "model-00004-of-00005.safetensors"
  "model-00005-of-00005.safetensors"
)

log "QWEN_CURL_START dir=$TE_DIR"

# Probe index first
resolve_ips || exit 9
PROBE=$(curl -4 -sI -L --max-redirs 8 "${RESOLVE[@]}" "$BASE/model.safetensors.index.json" 2>&1 | tr -d '\r')
echo "$PROBE" | grep -iE '^(HTTP/|location:|content-length:)' | tee -a "$LOG" | tail -12
if ! echo "$PROBE" | grep -qE 'HTTP/.* (200|302|307)'; then
  log "QWEN_PROBE_FAIL — try FP8 repo"
  BASE="https://huggingface.co/Qwen/Qwen3-8B-FP8/resolve/main"
  FILES=(
    "config.json"
    "generation_config.json"
    "tokenizer.json"
    "tokenizer_config.json"
    "vocab.json"
    "merges.txt"
    "model.safetensors.index.json"
    "model-00001-of-00002.safetensors"
    "model-00002-of-00002.safetensors"
  )
  PROBE=$(curl -4 -sI -L --max-redirs 8 "${RESOLVE[@]}" "$BASE/model.safetensors.index.json" 2>&1 | tr -d '\r')
  echo "$PROBE" | grep -iE '^(HTTP/|location:|content-length:)' | tee -a "$LOG" | tail -12
fi

for f in "${FILES[@]}"; do
  dest="$TE_DIR/$f"
  # Skip complete small configs; for shards check size later
  if [[ "$f" == *.safetensors ]]; then
    sz=$(stat -c%s "$dest" 2>/dev/null || echo 0)
    # shards are typically >1GB; skip if already large enough
    if [ "$sz" -gt 1000000000 ]; then
      log "SKIP_OK $f size=$sz"
      continue
    fi
  elif [ -f "$dest" ] && [ "$(stat -c%s "$dest")" -gt 100 ]; then
    log "SKIP_OK $f"
    continue
  fi
  log "DL $f"
  tmp="${dest}.part"
  set +e
  curl_get "$BASE/$f" "$tmp"
  rc=$?
  set -e
  if [ "$rc" -eq 0 ] && [ -f "$tmp" ] && [ "$(stat -c%s "$tmp")" -gt 0 ]; then
    mv -f "$tmp" "$dest"
    log "OK $f $(stat -c%s "$dest")"
  else
    log "FAIL $f rc=$rc size=$(stat -c%s "$tmp" 2>/dev/null || echo 0)"
    # continue trying other files; fail at end if no shards
  fi
done

SHARDS=$(ls "$TE_DIR"/model-*-of-*.safetensors 2>/dev/null | wc -l)
FIRST=$(ls "$TE_DIR"/model-*-of-*.safetensors 2>/dev/null | sort | head -1 || true)
TOT=$(du -sb "$TE_DIR" 2>/dev/null | awk '{print $1}')
log "QWEN_SUMMARY shards=$SHARDS first=$FIRST bytes=$TOT"
ls -lh "$TE_DIR" | tee -a "$LOG"

if [ "$SHARDS" -lt 2 ] || [ -z "$FIRST" ]; then
  log "QWEN_INCOMPLETE"
  exit 1
fi
# Need config + tokenizer + first shard at minimum for transformers
need=(config.json tokenizer.json tokenizer_config.json)
for n in "${need[@]}"; do
  if [ ! -f "$TE_DIR/$n" ]; then
    log "MISSING $n"
    exit 1
  fi
done
echo "$FIRST" > /work/train/models/qwen3-8b-first.txt
log "QWEN_READY $FIRST"
exit 0
