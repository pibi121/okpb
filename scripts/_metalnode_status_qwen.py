#!/usr/bin/env python3
"""SSH status check + curl-based Qwen3-8B download for musubi TE."""
from pathlib import Path
import paramiko
import sys
import time

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

KEY = Path(r"C:\Users\Олег\Downloads\metalnode_id_ed25519 (1).txt")
HOST = "77.94.203.13"
PORT = 22024

STATUS = r"""
echo '=== STATE ==='
ls -lh /work/train/models/flux-2-klein-base-9b-fp8.safetensors /work/train/models/flux-2-klein-base-9b-fp8.safetensors.part 2>/dev/null
ls -lh /work/ComfyUI/models/loras/olh_person_klein.safetensors 2>/dev/null || echo 'NO_LORA'
echo '=== PROCS ==='
ps aux | grep -E 'dl_qwen|snapshot|run_klein|curl|flux_2|huggingface' | grep -v grep | head -25
echo '=== QWEN DIR ==='
du -sh /work/train/models/qwen3-8b 2>/dev/null || echo empty
ls -lah /work/train/models/qwen3-8b 2>/dev/null | head -25 || true
echo '=== CACHE FILES ==='
ls /work/datasets/olh_person_klein/cache 2>/dev/null | wc -l
ls /work/datasets/olh_person_klein/cache/*_te.safetensors 2>/dev/null | head -3 || echo no_te_cache
echo '=== LOG TAIL ==='
tail -20 /work/loras_out/olh_person_klein_train.log
echo '=== QWEN NOHUP ==='
tail -40 /work/QWEN_DL.nohup 2>/dev/null
echo '=== DNS ==='
getent ahostsv4 huggingface.co | head -3
getent ahostsv4 us.aws.cdn.hf.co | head -3
getent ahostsv4 cas-bridge.xethub.hf.co | head -3
"""

# Qwen3-8B model files to download via curl+resolve
# From https://huggingface.co/Qwen/Qwen3-8B/tree/main
QWEN_FILES = [
    "config.json",
    "generation_config.json",
    "tokenizer.json",
    "tokenizer_config.json",
    "vocab.json",
    "merges.txt",
    "model.safetensors.index.json",
    "model-00001-of-00005.safetensors",
    "model-00002-of-00005.safetensors",
    "model-00003-of-00005.safetensors",
    "model-00004-of-00005.safetensors",
    "model-00005-of-00005.safetensors",
]


def ssh():
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    pkey = paramiko.Ed25519Key.from_private_key_file(str(KEY))
    c.connect(
        HOST,
        port=PORT,
        username="root",
        pkey=pkey,
        timeout=90,
        allow_agent=False,
        look_for_keys=False,
        banner_timeout=90,
    )
    return c


def run(c, cmd, timeout=120):
    _, so, se = c.exec_command(cmd, timeout=timeout)
    out = so.read().decode("utf-8", "replace")
    err = se.read().decode("utf-8", "replace")
    return out, err


def main():
    c = ssh()
    out, err = run(c, STATUS)
    print(out)
    if err.strip():
        print("STDERR:", err[:2000])
    c.close()


if __name__ == "__main__":
    main()
