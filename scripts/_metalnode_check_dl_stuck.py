#!/usr/bin/env python3
from pathlib import Path
import sys
import paramiko

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
KEY = Path(r"C:\Users\Олег\Downloads\metalnode_id_ed25519 (6).txt")

REMOTE = r'''
echo "=== processes ==="
ps aux | grep -E 'python|hf_|huggingface|curl|wget|install_llm' | grep -v grep | head -20
echo "=== log tail ==="
tail -30 /work/LLM_INSTALL.log
echo "=== cache sizes ==="
du -sh /root/.cache/huggingface 2>/dev/null || echo no_hf_cache
du -sh /work/llm 2>/dev/null
find /work/llm /root/.cache/huggingface -name '*.gguf*' -o -name '*.incomplete' 2>/dev/null | head -20
find /work/llm /root/.cache/huggingface -type f -size +100M 2>/dev/null | head -20
echo "=== network? ==="
ss -tpn | grep -E '443|huggingface' | head -10 || netstat -tpn 2>/dev/null | grep 443 | head -5
'''

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
pkey = paramiko.Ed25519Key.from_private_key_file(str(KEY))
c.connect("77.94.203.13", port=22024, username="root", pkey=pkey, timeout=30, allow_agent=False, look_for_keys=False)
stdin, stdout, stderr = c.exec_command(REMOTE, timeout=30)
print(stdout.read().decode(errors="replace"))
c.close()
