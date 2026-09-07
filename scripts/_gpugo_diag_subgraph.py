#!/usr/bin/env python3
import os
import paramiko

PASSWORD = os.environ.get("GPUGO_PASS") or "C5FdcIQ5"
OUT = os.path.join(os.path.dirname(__file__), "_subgraph_diag.txt")

REMOTE = r'''
python3 << 'PY'
import json, os, glob

paths = [
  "/workspace/user/default/workflows/Z-Image-ALLinONE-v2.json",
  "/workspace/user/default/workflows/Z-Image ALLinONE v2.json",
  "/opt/ComfyUI/blueprints/Z-Image-ALLinONE-v2.json",
]
for p in paths:
  if not os.path.exists(p):
    print("MISSING", p); continue
  d=json.load(open(p, encoding="utf-8"))
  print("====", p, "size", os.path.getsize(p))
  print("top_keys", sorted(d.keys()))
  print("version", d.get("version"))
  extra=d.get("extra") or {}
  print("extra_keys", list(extra.keys()))
  defs = d.get("definitions") or extra.get("definitions")
  if defs is not None:
    print("definitions type", type(defs).__name__, "keys" if isinstance(defs, dict) else len(defs))
    if isinstance(defs, dict):
      for k,v in list(defs.items())[:20]:
        print(" def", k, type(v).__name__, list(v.keys())[:20] if isinstance(v, dict) else str(v)[:120])
  # nodes that are subgraphs
  for n in d.get("nodes") or []:
    t = n.get("type") or ""
    props = n.get("properties") or {}
    if (
      "Subgraph" in t
      or t.startswith("workflow/")
      or "subgraph" in t.lower()
      or "subgraph" in json.dumps(props).lower()
      or n.get("nodes")
    ):
      print("SUBLIKE", {
        "id": n.get("id"),
        "type": t,
        "title": n.get("title"),
        "prop_keys": list(props.keys())[:20],
        "has_nodes": bool(n.get("nodes")),
        "has_inputs": len(n.get("inputs") or []),
        "has_outputs": len(n.get("outputs") or []),
      })
      # dump compact
      dump = {k: n[k] for k in n if k in ("id","type","title","properties","widgets_values","inputs","outputs")}
      # truncate large
      s = json.dumps(dump, ensure_ascii=False)
      print(s[:2000])
      print("---")

print("==== blueprint files ====")
for root in ["/opt/ComfyUI/blueprints", "/workspace/user/default/workflows", "/workspace/blueprints", "/opt/ComfyUI/user"]:
  if not os.path.isdir(root):
    continue
  for dirpath, dirnames, filenames in os.walk(root):
    for fn in filenames:
      if "subgraph" in fn.lower() or "blueprint" in fn.lower() or fn.endswith(".json"):
        fp = os.path.join(dirpath, fn)
        if "ALLinONE" in fn or "subgraph" in fn.lower() or "Z-Image" in fn:
          print(fp, os.path.getsize(fp))

# search comfy source for error string
print("==== error string in comfy ====")
os.system("grep -Rnl 'does not contain valid subgraph' /opt/ComfyUI --include='*.js' --include='*.ts' --include='*.py' 2>/dev/null | head -20")
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
    print(out[-4000:])
    c.close()


if __name__ == "__main__":
    main()
