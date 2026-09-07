#!/usr/bin/env python3
"""Prepare Ostris AI Toolkit + Z-Image Turbo training adapter on GPUGO.

Run when GPU is online:
  set GPUGO_PASS=...
  python _gpugo_setup_zimage_lora_train.py
"""
from __future__ import annotations

import os
import time
from pathlib import Path

import paramiko

PASSWORD = os.environ.get("GPUGO_PASS") or "C5FdcIQ5"
OUT = Path(__file__).with_name("_zimage_lora_setup_out.txt")


def connect():
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    last = None
    for i in range(8):
        try:
            c.connect(
                "95.165.71.177",
                port=42010,
                username="root",
                password=PASSWORD,
                timeout=60,
                allow_agent=False,
                look_for_keys=False,
                banner_timeout=60,
            )
            return c
        except Exception as e:
            last = e
            print("retry", i, e, flush=True)
            time.sleep(4)
    raise SystemExit(f"ssh fail: {last}")


def run(cmd: str, timeout: int = 1200) -> str:
    c = connect()
    try:
        print(">>>", cmd[:140].replace("\n", " "), flush=True)
        _, stdout, stderr = c.exec_command(cmd, timeout=timeout)
        out = stdout.read().decode(errors="replace")
        err = stderr.read().decode(errors="replace")
        with OUT.open("a", encoding="utf-8") as f:
            f.write("\n===== CMD =====\n" + cmd[:500] + "\n" + out)
            if err:
                f.write("\n--- ERR ---\n" + err[-5000:])
        print((out or "")[-2000:], flush=True)
        return out
    finally:
        c.close()


def main():
    OUT.write_text("start\n", encoding="utf-8")

    run(
        r'''
set -e
df -h /workspace | tail -1
nvidia-smi --query-gpu=name,memory.total --format=csv,noheader || true

mkdir -p /workspace/datasets/olh_person_zimage/images
mkdir -p /workspace/loras_out/olh_person_zimage
mkdir -p /workspace/train

# Ostris AI Toolkit
export GIT_TERMINAL_PROMPT=0
cd /workspace/train
if [ ! -d ai-toolkit ]; then
  git -c credential.helper= clone --depth 1 https://github.com/ostris/ai-toolkit.git ai-toolkit
else
  echo "ai-toolkit exists"
fi

# Training adapter (v1 stable)
mkdir -p /workspace/train/adapters
AD="/workspace/train/adapters/zimage_turbo_training_adapter_v1.safetensors"
if [ ! -f "$AD" ]; then
  /opt/ComfyUI/.venv/bin/pip -q install -U huggingface_hub || pip -q install -U huggingface_hub
  /opt/ComfyUI/.venv/bin/python - << 'PY' || python3 - << 'PY'
from huggingface_hub import hf_hub_download
import shutil, os
p = hf_hub_download(
  repo_id="ostris/zimage_turbo_training_adapter",
  filename="zimage_turbo_training_adapter_v1.safetensors",
)
dest = "/workspace/train/adapters/zimage_turbo_training_adapter_v1.safetensors"
shutil.copy2(p, dest)
print("adapter ->", dest, os.path.getsize(dest))
PY
else
  echo "adapter exists $(stat -c%s "$AD")"
fi

# README for user in dataset folder
cat > /workspace/datasets/olh_person_zimage/README.txt << 'EOF'
Put images in: /workspace/datasets/olh_person_zimage/images/
For each photo.jpg add photo.txt with at least: olh_person
Then tell the agent to start training.
EOF

ls -la /workspace/datasets/olh_person_zimage/
ls -la /workspace/train/adapters/ || true
ls /workspace/train/ai-toolkit | head
echo READY_FOLDERS_OK
'''
    )

    # Minimal job yaml template (filled when images exist)
    run(
        r'''
cat > /workspace/train/olh_person_zimage_job.yaml << 'EOF'
# Ostris AI Toolkit job template — Z-Image Turbo character LoRA
# Fill dataset path after images are uploaded. Start via toolkit UI or run.py
job: extension
config:
  name: olh_person_zimage
  process:
    - type: sd_trainer
      training_folder: /workspace/loras_out/olh_person_zimage
      device: cuda:0
      trigger_word: olh_person
      network:
        type: lora
        linear: 16
        linear_alpha: 16
      save:
        dtype: bf16
        save_every: 500
        max_step_saves_to_keep: 6
      datasets:
        - folder_path: /workspace/datasets/olh_person_zimage/images
          caption_ext: txt
          caption_dropout_rate: 0.05
          shuffle_tokens: false
          cache_latents_to_disk: true
          resolution: [512, 768, 1024]
      train:
        batch_size: 1
        steps: 2500
        gradient_accumulation: 1
        train_unet: true
        train_text_encoder: false
        gradient_checkpointing: true
        noise_scheduler: flowmatch
        optimizer: adamw8bit
        lr: 0.0001
        dtype: bf16
      model:
        name_or_path: Tongyi-MAI/Z-Image-Turbo
        assistant_lora_path: /workspace/train/adapters/zimage_turbo_training_adapter_v1.safetensors
        quantize: true
      sample:
        sampler: flowmatch
        sample_every: 250
        width: 1024
        height: 1024
        sample_steps: 8
        guidance_scale: 1
        seed: 42
        walk_seed: true
        prompts:
          - "olh_person, portrait photo, natural soft light, detailed face"
          - "olh_person, looking away, outdoor daylight, candid"
EOF
echo "wrote job yaml"
wc -l /workspace/train/olh_person_zimage_job.yaml

cat > /workspace/ZIMAGE_LORA_TRAIN_STATUS.txt << 'EOF'
Z-Image character LoRA setup

Folders:
  images: /workspace/datasets/olh_person_zimage/images/
  out:    /workspace/loras_out/olh_person_zimage/
  adapter + ai-toolkit under /workspace/train/

Next: upload 15-30 photos (+ .txt captions with olh_person), then start train.
EOF
cat /workspace/ZIMAGE_LORA_TRAIN_STATUS.txt
'''
    )
    print("DONE")


if __name__ == "__main__":
    main()
