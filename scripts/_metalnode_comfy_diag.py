#!/usr/bin/env python3
from pathlib import Path
import paramiko
import sys
import time

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
KEY = Path(r"C:\Users\Олег\Desktop\Проект Х\peachbitch\metalnode_id_ed25519")
OUT = Path(r"C:\Users\Олег\Desktop\Проект Х\peachbitch\scripts\_comfy_diag.txt")

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
pkey = paramiko.Ed25519Key.from_private_key_file(str(KEY))
c.connect("77.94.203.13", port=22024, username="root", pkey=pkey, timeout=60, allow_agent=False, look_for_keys=False)

_, so, _ = c.exec_command(
    r'''
echo '=== procs ==='
ps aux | grep -iE 'comfy|main.py|watchdog|tmux' | grep -v grep
echo '=== start script ==='
cat /work/bin/start-comfy.sh
echo '=== watchdog ==='
cat /usr/local/bin/comfy-watchdog.sh 2>/dev/null | head -60
echo '=== remove duplicate ControlAltAI ==='
rm -rf /work/ComfyUI/custom_nodes/ComfyUI-ControlAltAI-Nodes
ls /work/ComfyUI/custom_nodes | grep -i control
echo '=== kill and start ==='
tmux kill-session -t comfy 2>/dev/null || true
pkill -f '/work/ComfyUI' || true
pkill -f 'python main.py' || true
sleep 2
# start via same path as watchdog
cd /work/ComfyUI
nohup /work/bin/start-comfy.sh >/work/comfy_restart.log 2>&1 &
echo started_pid=$!
sleep 8
ps aux | grep 'main.py' | grep -v grep
echo '=== log ==='
tail -n 80 /work/comfy_restart.log
echo '=== user log ==='
tail -n 40 /work/ComfyUI/user/comfyui_8188.log 2>/dev/null
''',
    timeout=60,
)
text = so.read().decode("utf-8", errors="replace")
OUT.write_text(text, encoding="utf-8")
print(text[-5000:])
c.close()
