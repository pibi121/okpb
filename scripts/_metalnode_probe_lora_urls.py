#!/usr/bin/env python3
from pathlib import Path
import paramiko
import sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
KEY = Path(r"C:\Users\Олег\Downloads\metalnode_id_ed25519 (1).txt")
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
pkey = paramiko.Ed25519Key.from_private_key_file(str(KEY))
c.connect("77.94.203.13", port=22024, username="root", pkey=pkey, timeout=60, allow_agent=False, look_for_keys=False)

_, so, _ = c.exec_command(
    r'''
python3 - <<'PY'
import json, urllib.request, urllib.parse
UA={"User-Agent":"x"}

def get(url):
  req=urllib.request.Request(url, headers=UA)
  with urllib.request.urlopen(req, timeout=90) as r:
    return json.loads(r.read().decode())

for mid, vids in {
  "667086": ["2607212","2904324"],
  "1662740": ["2452071","2449027"],
  "2180048": ["2454851"],
}.items():
  for vid in vids:
    try:
      entries=get(f"https://huggingface.co/api/models/Sentinel7/z-image/tree/main/{mid}/{vid}")
      print(f"=== {mid}/{vid}")
      for e in entries:
        print(e.get("type"), e.get("path"), e.get("size"))
    except Exception as ex:
      print(f"=== {mid}/{vid} ERR {ex}")

for q in ["pen15_z_image_turbo", "coachbate penis zit", "CoachBate ZIT"]:
  try:
    items=get("https://huggingface.co/api/models?search=" + urllib.parse.quote(q) + "&limit=10")
    print("SEARCH", q)
    for m in items:
      print(" ", m.get("id"), m.get("downloads"))
  except Exception as ex:
    print("SEARCH ERR", q, ex)

# civarchive raw download pattern sometimes works
for url in [
  "https://civitai.com/api/download/models/2452071",
  "https://civitai.red/api/download/models/2452071",
]:
  try:
    req=urllib.request.Request(url, headers={"User-Agent":"Mozilla/5.0"}, method="HEAD")
    with urllib.request.urlopen(req, timeout=30) as r:
      print("HEAD", url, r.status, r.headers.get("content-length"), r.headers.get("content-disposition"))
  except Exception as ex:
    print("HEAD ERR", url, type(ex).__name__, ex)
PY
''',
    timeout=180,
)
print(so.read().decode("utf-8", errors="replace"))
c.close()
