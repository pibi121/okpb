#!/usr/bin/env python3
from pathlib import Path
import paramiko
import sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
KEY = Path(r"C:\Users\Олег\Desktop\Проект Х\peachbitch\metalnode_id_ed25519")
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
pkey = paramiko.Ed25519Key.from_private_key_file(str(KEY))
c.connect("77.94.203.13", port=22024, username="root", pkey=pkey, timeout=60, allow_agent=False, look_for_keys=False)

_, so, _ = c.exec_command(
    r'''
echo '=== cg-use-everywhere NODE_CLASS ==='
grep -R "NODE_CLASS_MAPPINGS\|SetNode\|GetNode\|Anything Everywhere" /work/ComfyUI/custom_nodes/cg-use-everywhere --include='*.py' | head -40
echo '=== rgthree Fast Groups ==='
grep -R "Fast Groups\|Bypasser\|NODE_CLASS_MAPPINGS" /work/ComfyUI/custom_nodes/rgthree-comfy --include='*.py' --include='*.js' | head -40
echo '=== object_info matching ==='
/work/ai/venv/bin/python3 - <<'PY'
import urllib.request, json
d=json.loads(urllib.request.urlopen('http://127.0.0.1:8188/object_info', timeout=60).read())
for k in sorted(d):
    kl=k.lower()
    if 'set' in kl or 'get' in kl or 'bypass' in kl or 'group' in kl or 'every' in kl:
        if any(x in kl for x in ['set','get','bypass','group','every','ue']):
            if any(x in kl for x in ['setnode','getnode','bypass','groups','everywhere','ue ']):
                print(k)
print('--- more ---')
for k in sorted(d):
    if 'Set' in k or 'Get' in k or 'Bypass' in k or 'Everywhere' in k or 'Group' in k:
        print(k)
PY
''',
    timeout=90,
)
Path(r"C:\Users\Олег\Desktop\Проект Х\peachbitch\scripts\_node_names.txt").write_text(
    so.read().decode("utf-8", errors="replace"), encoding="utf-8"
)
print(Path(r"C:\Users\Олег\Desktop\Проект Х\peachbitch\scripts\_node_names.txt").read_text(encoding="utf-8")[:6000])
c.close()
