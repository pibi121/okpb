#!/usr/bin/env python3
import os
import paramiko

PASSWORD = os.environ.get("GPUGO_PASS") or "C5FdcIQ5"
OUT = os.path.join(os.path.dirname(__file__), "_blueprint_cmp.txt")

REMOTE = r'''
python3 << 'PY'
import json, os, glob

def summarize(p):
  d=json.load(open(p, encoding='utf-8'))
  nodes=d.get('nodes') or []
  types=[n.get('type') for n in nodes]
  has_defs='definitions' in d
  # subgraph blueprint often has specific shape
  print(f"\nFILE {p}")
  print("  size", os.path.getsize(p), "keys", sorted(d.keys()))
  print("  n_nodes", len(nodes), "has_definitions", has_defs)
  print("  sample_types", types[:8])
  # check if any node is the subgraph root pattern
  for n in nodes[:3]:
    print("  node0", n.get('id'), n.get('type'), list((n.get('properties') or {}).keys())[:10])
  # frontendVersion
  extra=d.get('extra') or {}
  print("  frontendVersion", extra.get('frontendVersion'), "workflowRendererVersion", extra.get('workflowRendererVersion'))

for p in sorted(glob.glob('/opt/ComfyUI/blueprints/*.json')):
  summarize(p)

# find JS source of the error with strings
import pathlib
root=pathlib.Path('/opt/ComfyUI/.venv/lib/python3.12/site-packages/comfyui_frontend_package/static/assets')
hits=[]
for f in root.glob('*.js'):
  try:
    t=f.read_text(encoding='utf-8', errors='ignore')
  except Exception:
    continue
  if 'does not contain valid subgraph' in t:
    hits.append(f)
    i=t.find('does not contain valid subgraph')
    print('\nHIT', f.name)
    print(t[max(0,i-300):i+200])
print('hits', len(hits))
PY
'''


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
    _, stdout, stderr = c.exec_command(REMOTE, timeout=120)
    out = stdout.read().decode(errors="replace")
    err = stderr.read().decode(errors="replace")
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(out)
        if err:
            f.write("\nERR\n" + err)
    print(out)
    c.close()


if __name__ == "__main__":
    main()
