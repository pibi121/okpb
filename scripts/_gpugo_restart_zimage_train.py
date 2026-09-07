#!/usr/bin/env python3
"""Reliably start Z-Image LoRA training with nohup and verify log."""
import os
import time

import paramiko

PASSWORD = os.environ.get("GPUGO_PASS") or "C5FdcIQ5"


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
    c = connect()
    # Use a remote shell script file to avoid quoting issues
    script = r'''#!/bin/bash
set -e
cd /workspace/train/ai-toolkit
export HF_HOME=/workspace/hf_cache
export PYTHONUNBUFFERED=1
export HF_XET_HIGH_PERFORMANCE=1
mkdir -p /workspace/loras_out /workspace/hf_cache
pkill -f "run.py /workspace/train/olh_person_zimage_job.yaml" 2>/dev/null || true
sleep 1
: > /workspace/loras_out/olh_person_zimage_train.log
nohup ./venv/bin/python -u run.py /workspace/train/olh_person_zimage_job.yaml \
  >> /workspace/loras_out/olh_person_zimage_train.log 2>&1 &
echo $! > /workspace/loras_out/olh_person_zimage_train.pid
echo STARTED_PID=$(cat /workspace/loras_out/olh_person_zimage_train.pid)
sleep 5
ps -p $(cat /workspace/loras_out/olh_person_zimage_train.pid) -o pid,etime,cmd || echo DEAD
wc -l /workspace/loras_out/olh_person_zimage_train.log
tail -n 50 /workspace/loras_out/olh_person_zimage_train.log
'''
    sftp = c.open_sftp()
    with sftp.file("/tmp/start_zimage_train.sh", "w") as f:
        f.write(script)
    sftp.close()
    _, stdout, stderr = c.exec_command("bash /tmp/start_zimage_train.sh", timeout=120)
    out = stdout.read().decode(errors="replace")
    err = stderr.read().decode(errors="replace")
    print(out)
    print(err)
    c.close()

    # wait and poll log again
    time.sleep(20)
    c = connect()
    _, stdout, stderr = c.exec_command(
        "ps -p $(cat /workspace/loras_out/olh_person_zimage_train.pid) -o pid,etime,cmd 2>/dev/null; "
        "echo =====; tail -n 80 /workspace/loras_out/olh_person_zimage_train.log",
        timeout=60,
    )
    print(stdout.read().decode(errors="replace")[-5000:])
    c.close()


if __name__ == "__main__":
    main()
