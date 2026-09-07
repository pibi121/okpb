#!/usr/bin/env python3
"""Restore toolkit files and inject a stub torchaudio so image LoRA train can start."""
import os
import time

import paramiko

PASSWORD = os.environ.get("GPUGO_PASS") or "C5FdcIQ5"

STUB = '''# Stub torchaudio for image-only LoRA training on mismatched system torch.
class _Dummy:
    def __getattr__(self, name):
        raise RuntimeError(f"torchaudio stub: {name} not available")

def load(*args, **kwargs):
    raise RuntimeError("torchaudio stub cannot load audio")

def save(*args, **kwargs):
    raise RuntimeError("torchaudio stub cannot save audio")
'''

START = r'''#!/bin/bash
set -e
cd /workspace/train/ai-toolkit
export HF_HOME=/workspace/hf_cache
export PYTHONUNBUFFERED=1
export HF_XET_HIGH_PERFORMANCE=1
mkdir -p /workspace/loras_out /workspace/hf_cache
pkill -f "run.py /workspace/train/olh_person_zimage_job.yaml" >/dev/null 2>&1 || true
sleep 1
: > /workspace/loras_out/olh_person_zimage_train.log
nohup ./venv/bin/python -u run.py /workspace/train/olh_person_zimage_job.yaml \
  >> /workspace/loras_out/olh_person_zimage_train.log 2>&1 &
echo $! > /workspace/loras_out/olh_person_zimage_train.pid
sleep 6
PIDFILE=/workspace/loras_out/olh_person_zimage_train.pid
echo STARTED_PID=$(cat "$PIDFILE")
ps -p $(cat "$PIDFILE") -o pid,etime,cmd || echo DEAD
echo LOG_LINES=$(wc -l < /workspace/loras_out/olh_person_zimage_train.log)
tail -n 40 /workspace/loras_out/olh_person_zimage_train.log
'''


def main():
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
    sftp = c.open_sftp()
    # restore from git
    _, stdout, stderr = c.exec_command(
        "cd /workspace/train/ai-toolkit && git checkout -- toolkit/config_modules.py toolkit/dataloader_mixins.py",
        timeout=60,
    )
    print("git", stdout.read().decode(), stderr.read().decode())

    # write stub into venv site-packages BEFORE real torchaudio if any
    stub_path = "/workspace/train/ai-toolkit/venv/lib/python3.12/site-packages/torchaudio.py"
    # also remove broken torchaudio package dir if present
    _, stdout, stderr = c.exec_command(
        "rm -rf /workspace/train/ai-toolkit/venv/lib/python3.12/site-packages/torchaudio "
        "/workspace/train/ai-toolkit/venv/lib/python3.12/site-packages/torchaudio-*.dist-info "
        "2>/dev/null; ls /workspace/train/ai-toolkit/venv/lib/python3.12/site-packages | grep -i torchaudio || echo no_ta",
        timeout=60,
    )
    print(stdout.read().decode(), stderr.read().decode())

    with sftp.file(stub_path, "w") as f:
        f.write(STUB)
    print("wrote stub", stub_path)

    with sftp.file("/tmp/start_zimage_train.sh", "w") as f:
        f.write(START)
    sftp.close()

    _, stdout, stderr = c.exec_command(
        "cd /workspace/train/ai-toolkit && ./venv/bin/python -c 'import torchaudio; import toolkit.config_modules; print(\"imports_ok\")'",
        timeout=120,
    )
    print("import test:", stdout.read().decode(), stderr.read().decode()[-800:])

    _, stdout, stderr = c.exec_command("bash /tmp/start_zimage_train.sh", timeout=120)
    print(stdout.read().decode())
    print(stderr.read().decode()[-500:])
    c.close()

    time.sleep(30)
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
    # avoid $ expansion issues by using python remotely
    _, stdout, stderr = c.exec_command(
        "python3 - <<'PY'\n"
        "import pathlib,subprocess,os\n"
        "pid=pathlib.Path('/workspace/loras_out/olh_person_zimage_train.pid').read_text().strip()\n"
        "print('pid', pid)\n"
        "r=subprocess.run(['ps','-p',pid,'-o','pid,etime,cmd'],capture_output=True,text=True)\n"
        "print(r.stdout or 'DEAD')\n"
        "log=pathlib.Path('/workspace/loras_out/olh_person_zimage_train.log').read_text(errors='replace')\n"
        "print('===== LOG TAIL =====')\n"
        "print(log[-4000:])\n"
        "PY",
        timeout=60,
    )
    print(stdout.read().decode(errors="replace"))
    c.close()


if __name__ == "__main__":
    main()
