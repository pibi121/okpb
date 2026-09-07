#!/bin/bash
export PATH=/usr/bin:/bin
echo "=== FILES ==="
ls -lh /work/train/models/flux-2-klein-base-9b-fp8.safetensors* 2>/dev/null || echo none
echo "PART:$(stat -c%s /work/train/models/flux-2-klein-base-9b-fp8.safetensors.part 2>/dev/null || echo 0)"
echo "DIT:$(stat -c%s /work/train/models/flux-2-klein-base-9b-fp8.safetensors 2>/dev/null || echo 0)"
echo "=== PROCS ==="
pgrep -af 'curl|run_klein_lora|flux_2_train|flux_2_cache|dl_dit' | grep -v grep | head -20 || echo none
echo "=== LOG MARKS ==="
grep -E 'WAIT_DIT|DIT_OK|DIT_READY|CACHE_|TRAIN_|ALL_DONE|Traceback|curl_dit|DIT_FAIL' \
  /work/loras_out/olh_person_klein_train.log /work/KLEIN_TRAIN_SETUP.log /work/KLEIN_DIT.nohup 2>/dev/null | tail -30
echo "=== LORA ==="
ls -lh /work/ComfyUI/models/loras/olh_person_klein* /work/loras_out/olh_person_klein/*.safetensors 2>/dev/null || echo no_lora
echo "=== TAIL ==="
tail -c 600 /work/loras_out/olh_person_klein_train.log 2>/dev/null | tr '\r' '\n' | tail -10
echo "=== CURL LOG ==="
tail -c 400 /work/KLEIN_TRAIN_SETUP.log 2>/dev/null | tr '\r' '\n' | tail -6
