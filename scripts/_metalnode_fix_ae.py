#!/usr/bin/env python3
from pathlib import Path
import paramiko

KEY = Path(r"C:\Users\Олег\Desktop\Проект Х\peachbitch\metalnode_id_ed25519")
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
pkey = paramiko.Ed25519Key.from_private_key_file(str(KEY))
c.connect("77.94.203.13", port=22024, username="root", pkey=pkey, timeout=60, allow_agent=False, look_for_keys=False)

remote = r'''
python3 - <<'PY'
from pathlib import Path
import subprocess, time
part = Path("/work/ComfyUI/models/vae/ae.safetensors.part")
dest = Path("/work/ComfyUI/models/vae/ae.safetensors")
print("part", part.exists(), part.stat().st_size if part.exists() else 0)
r = subprocess.run(["pgrep", "-af", "vae/ae.safetensors"], capture_output=True, text=True)
print("procs", (r.stdout or "").strip())
# expected size 335304388
if part.exists() and part.stat().st_size >= 335304388 - 100 and "wget" not in (r.stdout or ""):
    if dest.exists():
        dest.unlink()
    part.rename(dest)
    print("renamed OK", dest.stat().st_size)
elif part.exists() and part.stat().st_size >= 300_000_000:
    # wait for wget to finish
    for i in range(30):
        r = subprocess.run(["pgrep", "-af", "vae/ae.safetensors"], capture_output=True, text=True)
        if "wget" not in (r.stdout or ""):
            break
        time.sleep(1)
    if part.exists() and part.stat().st_size >= 335304388 - 1000:
        if dest.exists():
            dest.unlink()
        part.rename(dest)
        print("renamed after wait", dest.stat().st_size)
print("vae:", [(p.name, p.stat().st_size) for p in Path("/work/ComfyUI/models/vae").iterdir()])
PY
'''
_, so, se = c.exec_command(remote, timeout=60)
print(so.read().decode(errors="replace"))
print(se.read().decode(errors="replace"))
c.close()
