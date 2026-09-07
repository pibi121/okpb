#!/usr/bin/env python3
"""Stop ComfyUI to free VRAM, tweak train yaml slightly, restart LoRA train."""
import os
import time
from pathlib import Path

import paramiko

PASSWORD = os.environ.get("GPUGO_PASS") or "C5FdcIQ5"
OUT = Path(__file__).with_name("_train_restart_oom_out.txt")

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
          resolution: [512, 768]
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
        width: 768
        height: 768
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

START = r'''#!/bin/bash
set -e
cd /workspace/train/ai-toolkit
export HF_HOME=/workspace/hf_cache
export PYTHONUNBUFFERED=1
export HF_XET_HIGH_PERFORMANCE=1
export PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True
mkdir -p /workspace/loras_out
pkill -f "run.py /workspace/train/olh_person_zimage_job.yaml" >/dev/null 2>&1 || true
sleep 2
: > /workspace/loras_out/olh_person_zimage_train.log
nohup ./venv/bin/python -u run.py /workspace/train/olh_person_zimage_job.yaml \
  >> /workspace/loras_out/olh_person_zimage_train.log 2>&1 &
echo $! > /workspace/loras_out/olh_person_zimage_train.pid
sleep 8
echo STARTED_PID=$(cat /workspace/loras_out/olh_person_zimage_train.pid)
ps -p $(cat /workspace/loras_out/olh_person_zimage_train.pid) -o pid,etime,cmd || echo DEAD
nvidia-smi --query-gpu=memory.used,memory.free --format=csv,noheader
tail -n 30 /workspace/loras_out/olh_person_zimage_train.log | tr -cd '\11\12\15\40-\176' | tail -n 30
'''


def connect():
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(
        "95.165.71.177",
        port=42010,
        username="root",
        password=PASSWORD,
        timeout=60,
        allow_agent=False,
        look_for_keys=False,
    )
    return c


def main():
    OUT.write_text("start\n", encoding="utf-8")
    c = connect()
    sftp = c.open_sftp()
    with sftp.file("/workspace/train/olh_person_zimage_job.yaml", "w") as f:
        f.write(YAML)
    with sftp.file("/tmp/start_zimage_train.sh", "w") as f:
        f.write(START)
    sftp.close()

    cmds = [
        "supervisorctl stop comfyui",
        "sleep 3",
        "nvidia-smi --query-gpu=memory.used,memory.free --format=csv,noheader",
        "bash /tmp/start_zimage_train.sh",
    ]
    for cmd in cmds:
        print(">>>", cmd, flush=True)
        _, stdout, stderr = c.exec_command(cmd, timeout=180)
        out = stdout.read().decode("utf-8", errors="replace")
        err = stderr.read().decode("utf-8", errors="replace")
        OUT.write_text(OUT.read_text(encoding="utf-8") + out + err, encoding="utf-8")
        print(out.encode("ascii", "replace").decode("ascii")[-1500:], flush=True)
        if err:
            print(err.encode("ascii", "replace").decode("ascii")[-500:], flush=True)
    c.close()

    time.sleep(45)
    # poll
    c = connect()
    _, stdout, stderr = c.exec_command(
        "python3 - <<'PY'\n"
        "import pathlib,subprocess\n"
        "pid=pathlib.Path('/workspace/loras_out/olh_person_zimage_train.pid').read_text().strip()\n"
        "r=subprocess.run(['ps','-p',pid,'-o','pid,etime,cmd'],capture_output=True,text=True)\n"
        "print(r.stdout if r.returncode==0 else 'DEAD')\n"
        "log=pathlib.Path('/workspace/loras_out/olh_person_zimage_train.log').read_text(errors='replace')\n"
        "print('LOG_BYTES', len(log))\n"
        "print(log[-2500:])\n"
        "PY",
        timeout=60,
    )
    text = stdout.read().decode("utf-8", errors="replace")
    Path(__file__).with_name("_train_log_tail.txt").write_text(text, encoding="utf-8")
    print(text.encode("ascii", "replace").decode("ascii")[-3000:])
    c.close()


if __name__ == "__main__":
    main()
