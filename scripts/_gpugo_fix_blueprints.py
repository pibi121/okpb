#!/usr/bin/env python3
"""Remove full workflows wrongly placed in blueprints/ (causes subgraph errors)."""
import os
import time

import paramiko

PASSWORD = os.environ.get("GPUGO_PASS") or "C5FdcIQ5"


def connect():
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
    return c


def run(cmd, timeout=120):
    c = connect()
    try:
        print(">>>", cmd[:100].replace("\n", " "), flush=True)
        _, stdout, stderr = c.exec_command(cmd, timeout=timeout)
        out = stdout.read().decode(errors="replace")
        err = stderr.read().decode(errors="replace")
        print(out[-2000:] if out else "", flush=True)
        if err.strip():
            print("ERR", err[-500:], flush=True)
        return out
    finally:
        c.close()


run(
    r'''
python3 << 'PY'
import json, os, shutil

bp = "/opt/ComfyUI/blueprints"
wf_dir = "/workspace/user/default/workflows"
os.makedirs(wf_dir, exist_ok=True)

removed = []
kept = []
for fn in os.listdir(bp):
    if not fn.endswith(".json"):
        continue
    path = os.path.join(bp, fn)
    try:
        d = json.load(open(path, encoding="utf-8"))
    except Exception as e:
        print("skip bad json", fn, e)
        continue
    nodes = d.get("nodes") or []
    defs = d.get("definitions") or {}
    subgraphs = (defs.get("subgraphs") if isinstance(defs, dict) else None) or []
    # Valid blueprint: first node type is UUID matching a subgraph definition id
    ok = False
    if nodes and subgraphs:
        first_type = nodes[0].get("type")
        ok = any(sg.get("id") == first_type for sg in subgraphs if isinstance(sg, dict))
    if ok:
        kept.append(fn)
        continue
    # Ensure a copy exists in workflows before removing from blueprints
    dest = os.path.join(wf_dir, fn)
    if not os.path.exists(dest):
        shutil.copy2(path, dest)
        print("copied to workflows:", fn)
    else:
        print("already in workflows:", fn)
    os.remove(path)
    removed.append(fn)
    print("REMOVED from blueprints:", fn)

print("REMOVED_COUNT", len(removed))
print("REMOVED_LIST", removed)
print("KEPT_COUNT", len(kept))
# confirm allinone still in workflows
for name in [
    "Z-Image-ALLinONE-v2.json",
    "Z-Image ALLinONE v2.json",
    "Text to Image (Z-Image-Base).json",
    "Text to Image (Flux UltraReal).json",
]:
    p = os.path.join(wf_dir, name)
    print("WF", name, "OK" if os.path.exists(p) else "MISSING")
print("blueprints left with ALLINONE?", any("ALLinONE" in x for x in os.listdir(bp)))
PY
'''
)

# also remove from /opt/ComfyUI/user if mirrored blueprints somehow - usually workflows only
run(
    r'''
# clear browser-side cached invalid blueprint index if any
rm -f /workspace/user/default/workflows/.index.json 2>/dev/null || true
ls /opt/ComfyUI/blueprints | grep -iE 'allinone|ultrareal|z-image-base' || echo "no bad names in blueprints"
echo "--- workflows ---"
ls /workspace/user/default/workflows | grep -iE 'allinone|ultrareal|z-image'
'''
)

print("DONE - user should Ctrl+F5 and open from Workflows not Templates/Blueprints")
