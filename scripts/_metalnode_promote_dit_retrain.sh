#!/bin/bash
export PATH=/usr/bin:/bin:/usr/local/bin
set -uo pipefail
DIT=/work/train/models/flux-2-klein-base-9b-fp8.safetensors
PART=${DIT}.part
EXPECT=9000000000
LOG=/work/loras_out/olh_person_klein_train.log

echo "=== before ==="
ls -lh "$DIT" "$PART" 2>/dev/null || true
sz=$(stat -c%s "$PART" 2>/dev/null || echo 0)
echo "PART_SIZE=$sz"

if [ -f "$DIT" ] && [ "$(stat -c%s "$DIT")" -ge "$EXPECT" ]; then
  echo DIT_ALREADY_OK
elif [ "$sz" -ge "$EXPECT" ]; then
  mv -f "$PART" "$DIT"
  echo "PROMOTED $(stat -c%s "$DIT")"
else
  echo "PART_TOO_SMALL"
  exit 2
fi

ln -sfn /work/ComfyUI/models/vae/ae.safetensors /work/train/models/ae.safetensors
ln -sfn /work/ComfyUI/models/text_encoders/qwen_3_8b_fp8mixed.safetensors /work/train/models/qwen_3_8b_fp8mixed.safetensors
ls -lh "$DIT" /work/train/models/

# Kill dead waiters and start fresh
pkill -f 'run_klein_lora_train.sh' || true
sleep 2
echo "===== MANUAL_RESTART $(date -Is) after promote =====" >> "$LOG"
nohup bash /tmp/run_klein_lora_train.sh >> /work/loras_out/olh_person_klein_train.nohup 2>&1 &
echo $! > /work/loras_out/olh_person_klein_train.pid
echo "TRAIN_PID:$(cat /work/loras_out/olh_person_klein_train.pid)"
sleep 5
tail -15 "$LOG"
pgrep -af 'run_klein_lora_train|flux_2_cache|flux_2_train' | head -10
