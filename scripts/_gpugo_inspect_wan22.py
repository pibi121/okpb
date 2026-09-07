#!/usr/bin/env python3
import json
import os

import paramiko

PASSWORD = os.environ.get("GPUGO_PASS") or "C5FdcIQ5"
OUT = os.path.join(os.path.dirname(__file__), "_wan22_blueprint.txt")


def main():
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
    cmd = r'''
python3 << 'PY'
import json
p="/opt/ComfyUI/blueprints/Image to Video (Wan 2.2).json"
d=json.load(open(p,encoding="utf-8"))
print("keys", sorted(d.keys()))
# if subgraph definitions
defs=d.get("definitions") or {}
subs=defs.get("subgraphs") if isinstance(defs, dict) else None
print("has_subgraphs", bool(subs), "n_nodes_top", len(d.get("nodes") or []))
# collect model filenames from whole json string
s=json.dumps(d)
import re
for m in sorted(set(re.findall(r"[A-Za-z0-9_./\\-]+\.(?:safetensors|pt|pth|gguf)", s))):
  if any(x in m.lower() for x in ("wan","umt5","clip","vae","vision","i2v","t2v")):
    print("MODEL", m)
# print widget values of loader-like nodes in top level
for n in d.get("nodes") or []:
  t=n.get("type","")
  w=n.get("widgets_values")
  if w and any(x in t.lower() for x in ("load","unet","vae","clip","wan","diffusion","vision")):
    print("NODE", n.get("id"), t, w)
# dig into definitions subgraphs nodes
if isinstance(subs, list):
  for sg in subs:
    for n in (sg.get("nodes") or []):
      t=n.get("type","")
      w=n.get("widgets_values")
      if isinstance(w, list) and any(isinstance(x,str) and x.endswith((".safetensors",".gguf")) for x in w):
        print("SG", t, [x for x in w if isinstance(x,str) and ("." in x)])
PY
ls -lh /opt/ComfyUI/blueprints/"Image to Video (Wan 2.2).json"
# also list HF-style names for wan2.2 if any docs on disk
'''
    _, stdout, stderr = c.exec_command(cmd, timeout=60)
    out = stdout.read().decode("utf-8", errors="replace")
    open(OUT, "w", encoding="utf-8").write(out)
    print(out)
    c.close()


if __name__ == "__main__":
    main()
