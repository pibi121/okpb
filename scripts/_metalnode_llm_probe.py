#!/usr/bin/env python3
"""Probe Metalnode for LLM install readiness."""
from pathlib import Path
import sys
import paramiko

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
KEY = Path(r"C:\Users\Олег\Downloads\metalnode_id_ed25519 (6).txt")

REMOTE = r'''
echo "=== GPU ==="
nvidia-smi --query-gpu=name,memory.total,memory.used,memory.free --format=csv,noheader
echo
echo "=== disk ==="
df -h /work / 2>/dev/null | head -5
echo
echo "=== comfy ==="
ps aux | grep -E 'main.py|ollama|llama' | grep -v grep || echo NO_LLM_OR_COMFY
echo
echo "=== ollama? ==="
which ollama 2>/dev/null || echo NO_OLLAMA
ollama --version 2>/dev/null || true
echo
echo "=== disk free under /work ==="
du -sh /work/ComfyUI/models 2>/dev/null | head -3
ls /work 2>/dev/null | head -20
echo
echo "=== python/venv ==="
ls /work/ai/venv/bin/python 2>/dev/null || echo NO_VENV
'''

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
pkey = paramiko.Ed25519Key.from_private_key_file(str(KEY))
c.connect("77.94.203.13", port=22024, username="root", pkey=pkey, timeout=30, allow_agent=False, look_for_keys=False)
stdin, stdout, stderr = c.exec_command(REMOTE, timeout=40)
print(stdout.read().decode(errors="replace"))
err = stderr.read().decode(errors="replace")
if err.strip():
    print("STDERR:", err[-1500:])
c.close()
