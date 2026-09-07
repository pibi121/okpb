#!/usr/bin/env python3
import os
import time

import paramiko

PASSWORD = os.environ.get("GPUGO_PASS") or "C5FdcIQ5"
OUT = os.path.join(os.path.dirname(__file__), "_ttn_out.txt")


def connect():
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    for i in range(8):
        try:
            c.connect(
                "95.165.71.177",
                port=42010,
                username="root",
                password=PASSWORD,
                timeout=60,
                allow_agent=False,
                look_for_keys=False,
                banner_timeout=60,
            )
            return c
        except Exception as e:
            print("retry", i, e, flush=True)
            time.sleep(3)
    raise SystemExit("ssh fail")


def run(cmd, timeout=600):
    c = connect()
    try:
        print(">>>", cmd[:120].replace("\n", " "), flush=True)
        _, stdout, stderr = c.exec_command(cmd, timeout=timeout)
        out = stdout.read().decode(errors="replace")
        err = stderr.read().decode(errors="replace")
        with open(OUT, "a", encoding="utf-8") as f:
            f.write("\n===== CMD =====\n")
            f.write(cmd[:400] + "\n")
            f.write(out)
            if err:
                f.write("\n--- ERR ---\n" + err)
        print((out or "")[-800:], flush=True)
        if err and "Username for" not in err:
            print("err_tail", err[-400:], flush=True)
        return out
    finally:
        c.close()


open(OUT, "w", encoding="utf-8").write("start\n")

# Install tinyterraNodes
run(
    r"""
export GIT_TERMINAL_PROMPT=0
cd /workspace/custom_nodes
if [ -d ComfyUI_tinyterraNodes ]; then
  echo EXISTS ComfyUI_tinyterraNodes
elif [ -d comfyui_tinyterranodes ]; then
  echo EXISTS comfyui_tinyterranodes
else
  git -c credential.helper= clone --depth 1 https://github.com/TinyTerra/ComfyUI_tinyterraNodes.git ComfyUI_tinyterraNodes
fi
ls -d *tiny* *ttN* 2>/dev/null || ls | grep -i tiny || true
# optional requirements
if [ -f ComfyUI_tinyterraNodes/requirements.txt ]; then
  /opt/ComfyUI/.venv/bin/pip install -q -r ComfyUI_tinyterraNodes/requirements.txt || true
fi
"""
)

# Also scan workflow for any other missing node types vs object_info after restart
run("supervisorctl restart comfyui")
time.sleep(40)

run(
    r"""
python3 - << 'PY'
import json, urllib.request, time, collections

# wait for API
d=None
for i in range(30):
  try:
    d=json.load(urllib.request.urlopen('http://127.0.0.1:9000/object_info', timeout=30)); break
  except Exception as e:
    print('wait', e); time.sleep(2)

checks = [
  'ttN text', 'ttN textDebug', 'ttN pipeLoader', 'ttN seed',
  'FluxResolutionNode', 'SeedVR2VideoUpscaler', 'Image Lucy Sharpen',
  'FaceDetailer', 'Power Lora Loader (rgthree)',
]
print('HAVE', [n for n in checks if n in d])
print('MISS', [n for n in checks if n not in d])
# any ttN*
ttn = [k for k in d if k.startswith('ttN') or 'ttN' in k]
print('ttN count', len(ttn))
print('ttN sample', ttn[:30])

# compare workflow node types
wf_paths = [
  '/workspace/user/default/workflows/Z-Image-ALLinONE-v2.json',
  '/workspace/user/default/workflows/Z-Image ALLinONE v2.json',
]
for p in wf_paths:
  try:
    wf=json.load(open(p, encoding='utf-8'))
  except Exception as e:
    print('no wf', p, e); continue
  types=collections.Counter()
  def walk(nodes):
    for n in nodes or []:
      t=n.get('type')
      if t: types[t]+=1
      # nested subgraphs sometimes under nodes
      if 'nodes' in n:
        walk(n.get('nodes'))
  walk(wf.get('nodes'))
  missing=[t for t in types if t not in d and t not in ('Reroute','Note','PrimitiveNode','MarkdownNote')]
  # frontend virtual often missing from object_info
  virtual={'SetNode','GetNode','Fast Groups Bypasser (rgthree)','Reroute','Note'}
  real_miss=[t for t in missing if t not in virtual]
  print('WF', p, 'node_types', len(types), 'real_miss', sorted(real_miss)[:40])

# log import fail
import subprocess
print(subprocess.getoutput("grep -E 'tinyterra|ttN|IMPORT FAILED|Cannot import' /opt/ComfyUI/user/comfyui_9000.log | tail -40"))
PY
"""
)

run(
    r"""
cat > /workspace/ALLINONE_STATUS.txt << 'EOF'
Z-Image All-in-One UPDATE

Installed: ComfyUI_tinyterraNodes (ttN text)

Do:
1. Ctrl+F5 in ComfyUI
2. Close missing-nodes dialog or reload workflow Z-Image-ALLinONE-v2
3. If still red LoRA models - Bypass those groups
4. Queue
EOF
cat /workspace/ALLINONE_STATUS.txt
"""
)
print("DONE")
