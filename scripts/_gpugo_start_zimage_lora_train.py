#!/usr/bin/env python3
"""Write train YAML, install AI Toolkit env, start Z-Image character LoRA training."""
from __future__ import annotations

import os
import time
from pathlib import Path

import paramiko

PASSWORD = os.environ.get("GPUGO_PASS") or "C5FdcIQ5"
OUT = Path(__file__).with_name("_zimage_train_start_out.txt")

YAML = r'''---
job: extension
config:
  name: "olh_person_zimage"
  process:
    - type: sd_trainer
      training_folder: "/workspace/loras_out"
      device: cuda:0
      trigger_word: "olh_person"
      network:
        type: "lora"
        linear: 16
        linear_alpha: 16
      save:
        dtype: bf16
        save_every: 500
        max_step_saves_to_keep: 6
        push_to_hub: false
      datasets:
        - folder_path: "/workspace/datasets/olh_person_zimage/images"
          caption_ext: "txt"
          caption_dropout_rate: 0.05
          shuffle_tokens: false
          cache_latents_to_disk: true
          resolution: [512, 768, 1024]
      train:
        batch_size: 1
        steps: 2500
        gradient_accumulation_steps: 1
        train_unet: true
        train_text_encoder: false
        gradient_checkpointing: true
        noise_scheduler: "flowmatch"
        optimizer: "adamw8bit"
        lr: 1.0e-4
        timestep_type: "weighted"
        ema_config:
          use_ema: true
          ema_decay: 0.99
        dtype: bf16
      model:
        name_or_path: "Tongyi-MAI/Z-Image-Turbo"
        arch: "zimage"
        assistant_lora_path: "/workspace/train/adapters/zimage_turbo_training_adapter_v1.safetensors"
        quantize: true
        quantize_te: true
        qtype: "qfloat8"
        low_vram: true
      sample:
        sampler: "flowmatch"
        sample_every: 500
        sample_start_step: 0
        width: 1024
        height: 1024
        prompts:
          - "olh_person, portrait photo, natural soft light, detailed face"
          - "olh_person, looking at camera, outdoor daylight, candid photo"
          - "olh_person, studio portrait, softbox lighting"
        neg: ""
        seed: 42
        walk_seed: true
        guidance_scale: 1
        sample_steps: 9
meta:
  name: "[name]"
  version: "1.0"
'''


def connect(retries=10):
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    last = None
    for i in range(retries):
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


def run(cmd: str, timeout: int = 3600) -> str:
    c = connect()
    try:
        print(">>>", cmd[:140].replace("\n", " "), flush=True)
        _, stdout, stderr = c.exec_command(cmd, timeout=timeout)
        out = stdout.read().decode(errors="replace")
        err = stderr.read().decode(errors="replace")
        with OUT.open("a", encoding="utf-8") as f:
            f.write("\n===== CMD =====\n" + cmd[:400] + "\n" + out[-8000:])
            if err:
                f.write("\n--- ERR ---\n" + err[-4000:])
        print((out or "")[-2000:], flush=True)
        if err and len(err) < 2000:
            print("err", err[-800:], flush=True)
        return out
    finally:
        c.close()


def main():
    OUT.write_text("start\n", encoding="utf-8")

    # upload yaml via sftp
    c = connect()
    sftp = c.open_sftp()
    with sftp.file("/workspace/train/olh_person_zimage_job.yaml", "w") as f:
        f.write(YAML)
    sftp.close()
    c.close()
    print("yaml uploaded", flush=True)

    # verify dataset
    run(
        "ls /workspace/datasets/olh_person_zimage/images/*.png | wc -l; "
        "ls /workspace/datasets/olh_person_zimage/images/*.txt | wc -l; "
        "head -1 /workspace/datasets/olh_person_zimage/images/olh_001.txt"
    )

    # setup venv + deps (reuse comfy torch if possible is hard; follow toolkit README)
    run(
        r'''
set -e
cd /workspace/train/ai-toolkit
export HF_HOME=/workspace/hf_cache
export HF_HUB_ENABLE_HF_TRANSFER=1
mkdir -p /workspace/hf_cache /workspace/loras_out

if [ ! -d venv ]; then
  /opt/ComfyUI/.venv/bin/python -m venv --system-site-packages venv || python3 -m venv venv
fi
. venv/bin/activate
python -m pip -q install -U pip setuptools wheel
# core requirements — may take several minutes
pip -q install -r requirements.txt || pip install -r requirements.txt
# bitsandbytes / hf transfer helpers
pip -q install hf_transfer || true
python -c "import torch; print('torch', torch.__version__, 'cuda', torch.cuda.is_available())"
python -c "import diffusers; print('diffusers', diffusers.__version__)"
# ZImagePipeline availability
python - << 'PY'
import diffusers
print('has ZImagePipeline', hasattr(diffusers, 'ZImagePipeline'))
PY
echo DEPS_OK
''',
        timeout=2400,
    )

    # start training in background with nohup
    run(
        r'''
set -e
cd /workspace/train/ai-toolkit
export HF_HOME=/workspace/hf_cache
export HF_HUB_ENABLE_HF_TRANSFER=1
export PYTHONUNBUFFERED=1
# kill previous train if any
pkill -f "run.py /workspace/train/olh_person_zimage_job.yaml" 2>/dev/null || true
sleep 1
nohup ./venv/bin/python run.py /workspace/train/olh_person_zimage_job.yaml \
  > /workspace/loras_out/olh_person_zimage_train.log 2>&1 &
echo $! > /workspace/loras_out/olh_person_zimage_train.pid
sleep 3
echo PID=$(cat /workspace/loras_out/olh_person_zimage_train.pid)
ps -p $(cat /workspace/loras_out/olh_person_zimage_train.pid) -o pid,cmd || ps aux | grep run.py | grep -v grep
echo '--- log head ---'
sleep 8
tail -n 40 /workspace/loras_out/olh_person_zimage_train.log || true
'''
    )
    print("STARTED")


if __name__ == "__main__":
    main()
