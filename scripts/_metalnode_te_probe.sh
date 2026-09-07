#!/bin/bash
export PATH=/usr/bin:/bin
echo "=== log markers ==="
grep -E 'CACHE_|TRAIN_|VAE|Error|Loading|ALL_DONE' /work/loras_out/olh_person_klein_train.log | tail -40
echo "=== cache dir ==="
ls -lah /work/datasets/olh_person_klein/cache 2>/dev/null | head -20
echo "=== te files ==="
ls -lh /work/ComfyUI/models/text_encoders/
echo "=== probe qwen ungated ==="
HF_IP=$(getent ahostsv4 huggingface.co | awk '{print $1; exit}')
for url in \
  "https://huggingface.co/Qwen/Qwen3-8B/resolve/main/model.safetensors.index.json" \
  "https://huggingface.co/Qwen/Qwen3-8B-FP8/resolve/main/model.safetensors.index.json"
do
  code=$(curl -4 -sI -o /dev/null -w "%{http_code}" --resolve "huggingface.co:443:${HF_IP}" --max-redirs 0 "$url" || true)
  echo "$code $url"
done
