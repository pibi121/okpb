#!/bin/bash
# Bootstrap: status, resume DiT if needed, ensure single train waiter
export PATH=/usr/bin:/bin:/usr/local/bin
set -uo pipefail

bash /tmp/quick_train_status.sh

DIT=/work/train/models/flux-2-klein-base-9b-fp8.safetensors
PART=${DIT}.part
EXPECT=9000000000

dit_ok=0
if [ -f "$DIT" ] && [ "$(stat -c%s "$DIT")" -ge "$EXPECT" ]; then
  dit_ok=1
fi
if [ -f "$PART" ] && [ "$(stat -c%s "$PART")" -ge "$EXPECT" ]; then
  mv -f "$PART" "$DIT"
  dit_ok=1
  echo "PROMOTED_EXISTING_PART"
fi

# Kill duplicate waiters; keep at most one
pkill -f 'run_klein_lora_train.sh' || true
sleep 2

# If DiT incomplete, ensure one curl resume
if [ "$dit_ok" -eq 0 ]; then
  if pgrep -f 'curl.*flux-2-klein-base-9b-fp8' >/dev/null; then
    echo "CURL_ALREADY_RUNNING"
    # If curl has empty resolve, kill and restart
    if pgrep -af 'curl.*flux-2-klein-base' | grep -q 'huggingface.co:443: --'; then
      echo "KILL_BAD_CURL_EMPTY_RESOLVE"
      pkill -f 'curl.*flux-2-klein-base' || true
      sleep 2
      nohup bash /tmp/dl_dit_resume.sh > /work/KLEIN_DIT.nohup 2>&1 &
      echo "DIT_RESUME_PID:$!"
    fi
  else
    nohup bash /tmp/dl_dit_resume.sh > /work/KLEIN_DIT.nohup 2>&1 &
    echo "DIT_RESUME_PID:$!"
  fi
else
  echo "DIT_ALREADY_OK $(stat -c%s "$DIT")"
fi

# Start exactly one waiter
nohup bash /tmp/run_klein_lora_train.sh >> /work/loras_out/olh_person_klein_train.nohup 2>&1 &
echo $! > /work/loras_out/olh_person_klein_train.pid
echo "TRAIN_WAITER_PID:$(cat /work/loras_out/olh_person_klein_train.pid)"
sleep 4
bash /tmp/quick_train_status.sh
