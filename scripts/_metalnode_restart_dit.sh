#!/bin/bash
pkill -f 'curl.*flux-2-klein-base' || true
sleep 2
nohup bash /tmp/dl_dit_resume.sh > /work/KLEIN_DIT.nohup 2>&1 &
echo "PID:$!"
sleep 10
pgrep -a curl | head -2
ls -lh /work/train/models/
tail -c 400 /work/KLEIN_TRAIN_SETUP.log | tr '\r' '\n' | tail -6
tail -5 /work/loras_out/olh_person_klein_train.log 2>/dev/null
