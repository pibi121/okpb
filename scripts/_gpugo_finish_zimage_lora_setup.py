#!/usr/bin/env python3
"""Finish AI Toolkit + adapter install (no nested heredoc issues)."""
import os
import time
from pathlib import Path

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


def run(cmd, timeout=1800):
    c = connect()
    try:
        print(">>>", cmd[:100], flush=True)
        _, stdout, stderr = c.exec_command(cmd, timeout=timeout)
        out = stdout.read().decode(errors="replace")
        err = stderr.read().decode(errors="replace")
        print(out[-2500:] if out else "", flush=True)
        if err:
            print("ERR", err[-1500:], flush=True)
        return out
    finally:
        c.close()


# Upload a remote helper script via sftp to avoid quoting hell
HELPER = r'''#!/usr/bin/env python3
import os, shutil
from pathlib import Path

Path("/workspace/train/adapters").mkdir(parents=True, exist_ok=True)
Path("/workspace/datasets/olh_person_zimage/images").mkdir(parents=True, exist_ok=True)
Path("/workspace/loras_out/olh_person_zimage").mkdir(parents=True, exist_ok=True)

atk = Path("/workspace/train/ai-toolkit")
if not atk.exists():
    os.system("GIT_TERMINAL_PROMPT=0 git -c credential.helper= clone --depth 1 https://github.com/ostris/ai-toolkit.git /workspace/train/ai-toolkit")
print("ai-toolkit", atk.exists(), "entries", len(list(atk.iterdir())) if atk.exists() else 0)

dest = Path("/workspace/train/adapters/zimage_turbo_training_adapter_v1.safetensors")
if not dest.exists() or dest.stat().st_size < 1000:
    try:
        from huggingface_hub import hf_hub_download
    except ImportError:
        os.system("/opt/ComfyUI/.venv/bin/pip -q install -U huggingface_hub")
        from huggingface_hub import hf_hub_download
    p = hf_hub_download(
        repo_id="ostris/zimage_turbo_training_adapter",
        filename="zimage_turbo_training_adapter_v1.safetensors",
    )
    shutil.copy2(p, dest)
print("adapter", dest, dest.stat().st_size if dest.exists() else 0)
print("OK")
'''


def main():
    c = connect()
    sftp = c.open_sftp()
    with sftp.file("/tmp/setup_zimage_lora.py", "w") as f:
        f.write(HELPER)
    sftp.close()
    c.close()

    run("/opt/ComfyUI/.venv/bin/python /tmp/setup_zimage_lora.py || python3 /tmp/setup_zimage_lora.py")
    run("ls -lh /workspace/train/adapters/; ls /workspace/train/ai-toolkit | head; ls /workspace/datasets/olh_person_zimage/images | wc -l")
    print("DONE")


if __name__ == "__main__":
    main()
