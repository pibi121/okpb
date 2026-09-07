#!/bin/bash
export PATH=/usr/bin:/bin:/usr/local/bin
echo "=== FILES ==="
ls -lh /work/train/models/flux-2-klein-base-9b-fp8.safetensors* 2>/dev/null || echo none
echo PART:$(stat -c%s /work/train/models/flux-2-klein-base-9b-fp8.safetensors.part 2>/dev/null || echo 0)
echo DIT:$(stat -c%s /work/train/models/flux-2-klein-base-9b-fp8.safetensors 2>/dev/null || echo 0)
echo "=== PROCS ==="
pgrep -af 'curl.*klein-base|run_klein_lora_train|flux_2_train_network|flux_2_cache' | head -15 || echo none
echo "=== LOG ==="
tail -c 800 /work/loras_out/olh_person_klein_train.log 2>/dev/null | tr '\r' '\n' | tail -15
echo "=== MARKERS ==="
grep -E 'WAIT_DIT|DIT_OK|CACHE_|TRAIN_|ALL_DONE|INSTALLED|DIT_MISSING|Traceback' /work/loras_out/olh_person_klein_train.log 2>/dev/null | tail -15
echo "=== LORA ==="
ls -lh /work/ComfyUI/models/loras/olh_person_klein.safetensors 2>/dev/null || echo missing
echo "=== ENV ==="
grep ENV_OK /work/KLEIN_MUSUBI_ENV.log 2>/dev/null | tail -1 || echo no_env
echo "=== DS ==="
ls /work/datasets/olh_person_klein/images/*.png 2>/dev/null | wc -l
echo "=== HOSTS ==="
grep -nE 'huggingface|hf\.co|xethub' /etc/hosts || echo hosts_clean
