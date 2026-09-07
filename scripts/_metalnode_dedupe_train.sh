#!/bin/bash
export PATH=/usr/bin:/bin
# Keep one train waiter, kill duplicates
pids=$(pgrep -f 'bash /tmp/run_klein_lora_train.sh' || true)
echo "PIDS:$pids"
count=$(echo "$pids" | wc -w)
if [ "$count" -gt 1 ]; then
  keep=$(echo "$pids" | awk '{print $1}')
  for p in $pids; do
    if [ "$p" != "$keep" ]; then
      echo "KILL_DUP $p"
      kill "$p" || true
    fi
  done
fi
pgrep -af 'run_klein_lora_train|curl.*klein-base' | head -10
ls -lh /work/train/models/
