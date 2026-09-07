#!/usr/bin/env python3
from pathlib import Path
import sys
import paramiko

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
KEY = Path(r"C:\Users\Олег\Downloads\metalnode_id_ed25519 (6).txt")

REMOTE = r'''
echo "=== ollama binary ==="
which ollama; ollama --version 2>/dev/null || echo NO_OLLAMA
echo "=== gguf ==="
ls -lh /work/llm/gguf/*.gguf 2>/dev/null || echo NO_GGUF
echo "=== ollama models ==="
ollama list 2>/dev/null || true
ls -lh /root/.ollama/models/manifests/registry.ollama.ai/library/ 2>/dev/null || true
echo "=== modelfile ==="
head -20 /work/llm/Modelfile 2>/dev/null || echo NO_MODELFILE
'''

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
pkey = paramiko.Ed25519Key.from_private_key_file(str(KEY))
c.connect("77.94.203.13", port=22024, username="root", pkey=pkey, timeout=60, banner_timeout=60, allow_agent=False, look_for_keys=False)
stdin, stdout, stderr = c.exec_command(REMOTE, timeout=30)
print(stdout.read().decode(errors="replace"))
c.close()
