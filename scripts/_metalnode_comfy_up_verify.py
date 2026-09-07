#!/usr/bin/env python3
from pathlib import Path
import paramiko
import sys
import time

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
KEY = Path(r"C:\Users\Олег\Desktop\Проект Х\peachbitch\metalnode_id_ed25519")
OUT = Path(r"C:\Users\Олег\Desktop\Проект Х\peachbitch\scripts\_comfy_up.txt")

NEEDED = [
    "Anything Everywhere", "Blur", "ChromaticAberration", "ColorCorrect", "FaceDetailer",
    "Fast Groups Bypasser (rgthree)", "FilmGrain", "FluxResolutionNode", "GetNode",
    "Image Bloom Filter", "Image Comparer (rgthree)", "Image Lucy Sharpen",
    "ImageCASharpening+", "ImageResize+", "Lora Loader Stack (rgthree)",
    "Power Lora Loader (rgthree)", "SAMLoader", "SeedVR2LoadDiTModel",
    "SeedVR2LoadVAEModel", "SeedVR2VideoUpscaler", "SetNode",
    "UltralyticsDetectorProvider", "ttN text",
]

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
pkey = paramiko.Ed25519Key.from_private_key_file(str(KEY))
c.connect("77.94.203.13", port=22024, username="root", pkey=pkey, timeout=60, allow_agent=False, look_for_keys=False)
c.get_transport().set_keepalive(20)

# Check if comfy already up; if not start via tmux as originally
cmd1 = r'''
ps -eo pid,args | grep -E 'main.py|comfy-watchdog|tmux' | grep -v grep
curl -s -o /dev/null -w "http=%{http_code}\n" http://127.0.0.1:8188/system_stats || echo http=down
# If down, start tmux session (watchdog expects this)
if ! curl -fsS --max-time 2 http://127.0.0.1:8188/system_stats >/dev/null 2>&1; then
  tmux has-session -t comfy 2>/dev/null || tmux new-session -d -s comfy /work/bin/start-comfy.sh
  echo started_tmux
fi
'''
_, so, _ = c.exec_command(cmd1, timeout=30)
print(so.read().decode("utf-8", errors="replace"))

# wait for up
for i in range(45):
    _, so, _ = c.exec_command(
        'curl -fsS --max-time 2 http://127.0.0.1:8188/system_stats >/dev/null && echo UP || echo WAIT',
        timeout=15,
    )
    s = so.read().decode().strip()
    print(i, s, flush=True)
    if s == "UP":
        break
    time.sleep(3)

time.sleep(10)  # custom nodes import

# get object_info keys
_, so, se = c.exec_command(
    r'''/work/ai/venv/bin/python3 - <<'PY'
import urllib.request, json
try:
    raw = urllib.request.urlopen('http://127.0.0.1:8188/object_info', timeout=60).read()
    d = json.loads(raw)
    print('TOTAL', len(d))
    open('/tmp/obj_keys.txt','w').write('\n'.join(sorted(d.keys())))
except Exception as e:
    print('ERR', e)
    # show log
    import pathlib
    for p in [pathlib.Path('/work/comfy_restart.log'), pathlib.Path('/work/ComfyUI/user/comfyui_8188.log'), pathlib.Path('/var/log/comfy-watchdog.log')]:
        if p.exists():
            print('---', p, '---')
            print(p.read_text(errors='replace')[-3000:])
PY''',
    timeout=90,
)
print(so.read().decode("utf-8", errors="replace"))
print(se.read().decode("utf-8", errors="replace")[-500:])

_, so, _ = c.exec_command("cat /tmp/obj_keys.txt 2>/dev/null | wc -l; tail -n 5 /var/log/comfy-watchdog.log; tail -n 80 /work/ComfyUI/user/comfyui_8188.log 2>/dev/null", timeout=30)
extra = so.read().decode("utf-8", errors="replace")

_, so, _ = c.exec_command("cat /tmp/obj_keys.txt 2>/dev/null", timeout=30)
keys = set(so.read().decode("utf-8", errors="replace").splitlines())

lines = [f"keys={len(keys)}", extra[-2000:], ""]
for n in NEEDED:
    lines.append(("OK   " if n in keys else "MISS ") + n)
if any(n not in keys for n in NEEDED):
    lines.append("\nfuzzy:")
    for n in NEEDED:
        if n not in keys:
            hits = [k for k in keys if n[:8].lower() in k.lower() or (n.split()[0].lower() in k.lower() and len(n.split()[0])>3)]
            lines.append(f"  {n} => {hits[:6]}")

OUT.write_text("\n".join(lines), encoding="utf-8")
print(OUT.read_text(encoding="utf-8"))
c.close()
