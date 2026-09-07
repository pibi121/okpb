#!/bin/bash
export PATH=/usr/bin:/bin
mkdir -p /work/loras_out /work/train/models
nohup bash /tmp/dl_dit_resume.sh > /work/KLEIN_DIT.nohup 2>&1 &
echo "DIT_PID:$!"
if pgrep -f 'run_klein_lora_train.sh' >/dev/null; then
  echo TRAIN_ALREADY
  pgrep -af 'run_klein_lora_train|flux_2_train|WAIT_DIT' | head -5
else
  nohup bash /tmp/run_klein_lora_train.sh > /work/loras_out/olh_person_klein_train.nohup 2>&1 &
  echo $! > /work/loras_out/olh_person_klein_train.pid
  echo "TRAIN_PID:$(cat /work/loras_out/olh_person_klein_train.pid)"
fi
sleep 4
ls -lh /work/train/models/
pgrep -a curl | head -2
tail -8 /work/loras_out/olh_person_klein_train.log 2>/dev/null || tail -8 /work/loras_out/olh_person_klein_train.nohup 2>/dev/null
grep -E 'ENV_OK|DIT_READY|WAIT_DIT|CACHE_|TRAIN_' /work/loras_out/olh_person_klein_train.log 2>/dev/null | tail -10
