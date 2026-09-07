#!/usr/bin/env python3
from pathlib import Path
import sys
import paramiko

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
KEY = Path(r"C:\Users\Олег\Downloads\metalnode_id_ed25519 (5).txt")

def run(client, cmd, timeout=60):
    stdin, stdout, stderr = client.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode(errors="replace")
    err = stderr.read().decode(errors="replace")
    return out, err

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
pkey = paramiko.Ed25519Key.from_private_key_file(str(KEY))
c.connect("77.94.203.13", port=22022, username="root", pkey=pkey, timeout=30, allow_agent=False, look_for_keys=False)

out, err = run(c, "cat /work/bin/start-comfy.sh")
print("BEFORE:\n", out)

# patch via python on remote
patch = r'''
from pathlib import Path
p = Path("/work/bin/start-comfy.sh")
t = p.read_text()
p.write_text(t)  # noop ensure writable
bak = Path("/work/bin/start-comfy.sh.bak_before_pytorch_attn")
if not bak.exists():
    bak.write_text(t)
if "use-pytorch-cross-attention" not in t:
    if "--enable-manager" in t:
        t = t.replace("--enable-manager", "--enable-manager --use-pytorch-cross-attention")
    elif "main.py --listen --port 8188" in t:
        t = t.replace("main.py --listen --port 8188", "main.py --listen --port 8188 --use-pytorch-cross-attention")
    else:
        raise SystemExit("cannot patch: unexpected start-comfy.sh")
    p.write_text(t)
print(p.read_text())
'''
sftp = c.open_sftp()
with sftp.file("/work/_patch_start.py", "w") as f:
    f.write(patch)
sftp.close()
out, err = run(c, "python3 /work/_patch_start.py")
print("AFTER:\n", out, err)

# kill and restart cleanly
out, err = run(c, "tmux kill-session -t comfy 2>/dev/null; pkill -f 'main.py --listen --port 8188' || true; sleep 2; echo killed", timeout=30)
print(out)

out, err = run(c, "/work/bin/run-comfy-tmux.sh; echo START_RC=$?", timeout=30)
print(out, err)

# wait for up
out, err = run(c, '''
for i in $(seq 1 40); do
  if curl -sf http://127.0.0.1:8188/system_stats >/dev/null; then echo COMFY_UP $i; ps aux | grep 'main.py' | grep -v grep; exit 0; fi
  sleep 2
done
echo COMFY_DOWN; ps aux | grep 'main.py' | grep -v grep || true; exit 1
''', timeout=100)
print(out, err)
c.close()
