#!/usr/bin/env python3
"""Download ZIT LoRAs onto Metalnode."""
from pathlib import Path
import paramiko
import sys
import time

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
KEY = Path(r"C:\Users\Олег\Downloads\metalnode_id_ed25519 (1).txt")
if not KEY.exists():
    KEY = Path(r"C:\Users\Олег\Desktop\Проект Х\peachbitch\metalnode_id_ed25519")

REMOTE = r'''#!/usr/bin/env python3
import os, time, subprocess
from pathlib import Path

LORAS = Path("/work/ComfyUI/models/loras")
LOG = Path("/work/INSTALL_LORAS.log")
STATUS = Path("/work/INSTALL_LORAS_STATUS.txt")

# (dest_name, urls[], min_bytes)
ITEMS = [
  (
    "Detailed_Nipples_Z.safetensors",
    [
      "https://huggingface.co/LoRa121/Nipples_Z/resolve/main/Detailed_Nipples_Z.safetensors",
      "https://huggingface.co/Sentinel7/z-image/resolve/main/2180048/2454851/Detailed_Nipples_Z.safetensors",
    ],
    100_000_000,
  ),
  (
    "NSFW_master_ZIT.safetensors",
    [
      "https://huggingface.co/Sentinel7/z-image/resolve/main/667086/2904324/NSFW_master_ZIT_000017532.safetensors",
      "https://huggingface.co/FanzCEO/NSFW-MASTER-Z-IMAGE-TURBO/resolve/main/NSFW_master_ZIT_000017532.safetensors",
      "https://huggingface.co/thutes-gbr25/NSFW-MASTER-Z-IMAGE-TURBO/resolve/main/NSFW_master_ZIT_000017532.safetensors",
      "https://civitai.com/api/download/models/2904324",
    ],
    50_000_000,
  ),
  (
    "lenovo_ultrareal_zit.safetensors",
    [
      "https://huggingface.co/Sentinel7/z-image/resolve/main/1662740/2452071/lenovo_z.safetensors",
      "https://civitai.com/api/download/models/2452071",
      "https://civitai.red/api/download/models/2452071",
    ],
    50_000_000,
  ),
  (
    "pen15_z_image_turbo_coachbate.safetensors",
    [
      # ZIT v2 common names / mirrors
      "https://huggingface.co/Sentinel7/z-image/resolve/main/2235050/2518608/pen15_z_image_turbo-v2.safetensors",
      "https://huggingface.co/Sentinel7/z-image/resolve/main/2235050/2518608/pen15_z_image_turbo_v2.safetensors",
      "https://huggingface.co/Sentinel7/z-image/resolve/main/2235050/2450000/pen15_z_image_turbo-v1.safetensors",
      "https://civitai.com/api/download/models/2518608",
      "https://civitai.red/api/download/models/2518608",
    ],
    50_000_000,
  ),
]

def log(msg):
    line = f"[{time.strftime('%H:%M:%S')}] {msg}"
    print(line, flush=True)
    with LOG.open("a", encoding="utf-8") as f:
        f.write(line + "\n")

def download(dest: Path, urls, min_ok: int) -> bool:
    if dest.exists() and dest.stat().st_size > min_ok:
        log(f"EXISTS {dest.name} ({dest.stat().st_size})")
        return True
    part = Path(str(dest) + ".part")
    for url in urls:
        if part.exists():
            try: part.unlink()
            except Exception: pass
        log(f"TRY {dest.name} <- {url[:90]}")
        r = subprocess.run(
            ["wget", "-4", "--content-disposition", "-c", "-O", str(part), url],
            capture_output=True, text=True, timeout=1800,
        )
        # civitai may redirect to weird names via content-disposition; we force -O
        sz = part.stat().st_size if part.exists() else 0
        if r.returncode == 0 and sz > min_ok:
            # if wget ignored -O somehow
            part.rename(dest)
            log(f"OK {dest.name} ({dest.stat().st_size})")
            return True
        log(f"fail rc={r.returncode} size={sz} err={(r.stderr or '')[-300:]}")
        # also search for newly downloaded large files in cwd
    # probe Sentinel7 tree for coachbate / nsfw via huggingface API
    return False

def probe_hf_and_fix():
    """List Sentinel7/z-image folders for missing items and try discovered paths."""
    import json, urllib.request
    need = {
        "pen15": "pen15_z_image_turbo_coachbate.safetensors",
        "NSFW_master": "NSFW_master_ZIT.safetensors",
        "lenovo": "lenovo_ultrareal_zit.safetensors",
    }
    missing = {k: v for k, v in need.items() if not (LORAS / v).exists() or (LORAS / v).stat().st_size < 1_000_000}
    if not missing:
        return
    log(f"HF probe for: {list(missing)}")
    try:
        req = urllib.request.Request(
            "https://huggingface.co/api/models/Sentinel7/z-image/tree/main?recursive=1&expand=false",
            headers={"User-Agent": "metalnode-setup"},
        )
        with urllib.request.urlopen(req, timeout=120) as resp:
            tree = json.loads(resp.read().decode())
    except Exception as e:
        log(f"HF tree fail: {e}")
        # fallback: shallow known model id dirs
        for mid in ("2235050", "667086", "1662740", "2180048"):
            try:
                req = urllib.request.Request(
                    f"https://huggingface.co/api/models/Sentinel7/z-image/tree/main/{mid}",
                    headers={"User-Agent": "metalnode-setup"},
                )
                with urllib.request.urlopen(req, timeout=60) as resp:
                    entries = json.loads(resp.read().decode())
                log(f"dir {mid}: {[e.get('path') for e in entries][:20]}")
            except Exception as e2:
                log(f"dir {mid} fail: {e2}")
        return

    paths = []
    entries = tree if isinstance(tree, list) else []
    for e in entries:
        p = e.get("path") or ""
        if p.endswith(".safetensors"):
            paths.append(p)
    log(f"HF files found: {len(paths)}")
    mapping = []
    for p in paths:
        pl = p.lower()
        if ("pen15" in pl) or ("coachbate" in pl and "pen" in pl) or ("z_image_turbo" in pl and "pen" in pl):
            mapping.append(("pen15_z_image_turbo_coachbate.safetensors", p))
        if "nsfw_master" in pl or "nsfw-master" in pl.replace(" ", ""):
            mapping.append(("NSFW_master_ZIT.safetensors", p))
        if "lenovo" in pl:
            mapping.append(("lenovo_ultrareal_zit.safetensors", p))
        if "detailed_nipples_z" in pl:
            mapping.append(("Detailed_Nipples_Z.safetensors", p))
    for dest_name, rel in mapping:
        dest = LORAS / dest_name
        if dest.exists() and dest.stat().st_size > 1_000_000:
            continue
        url = f"https://huggingface.co/Sentinel7/z-image/resolve/main/{rel}"
        download(dest, [url], 10_000_000)

def main():
    LOG.write_text("install loras\n", encoding="utf-8")
    LORAS.mkdir(parents=True, exist_ok=True)
    ok = True
    for name, urls, min_ok in ITEMS:
        if not download(LORAS / name, urls, min_ok):
            ok = False
    probe_hf_and_fix()
    # final check
    wanted = [i[0] for i in ITEMS]
    lines = []
    all_ok = True
    for n in wanted:
        p = LORAS / n
        sz = p.stat().st_size if p.exists() else 0
        lines.append(f"{'OK' if sz > 1_000_000 else 'MISS':4} {n} {sz}")
        if sz <= 1_000_000:
            all_ok = False
    lines.append("")
    lines.append("Stack tips:")
    lines.append("  olh_person 0.7-0.85")
    lines.append("  pen15_z_image_turbo_coachbate 0.6-0.8 (trigger: pen15)")
    lines.append("  Detailed_Nipples_Z 0.5-0.7")
    lines.append("  NSFW_master_ZIT 0.5-0.7")
    lines.append("  lenovo_ultrareal_zit 0.7-0.9")
    STATUS.write_text(("READY" if all_ok else "PARTIAL") + "\n\n" + "\n".join(lines) + "\n")
    log("STATUS written")
    print(STATUS.read_text())
    # list dir
    for p in sorted(LORAS.glob("*.safetensors")):
        log(f"  {p.name} {p.stat().st_size}")

if __name__ == "__main__":
    main()
'''


def main():
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    pkey = paramiko.Ed25519Key.from_private_key_file(str(KEY))
    c.connect("77.94.203.13", port=22024, username="root", pkey=pkey, timeout=60, allow_agent=False, look_for_keys=False)
    c.get_transport().set_keepalive(20)

    sftp = c.open_sftp()
    with sftp.file("/tmp/install_loras.py", "w") as f:
        f.write(REMOTE)
    sftp.close()

    # First: discover Sentinel7 paths quickly
    _, so, _ = c.exec_command(
        r'''
python3 - <<'PY'
import json, urllib.request
for mid in ["2235050","667086","1662740","2180048"]:
  try:
    req=urllib.request.Request(f"https://huggingface.co/api/models/Sentinel7/z-image/tree/main/{mid}", headers={"User-Agent":"x"})
    with urllib.request.urlopen(req, timeout=60) as r:
      entries=json.loads(r.read().decode())
    print("===", mid)
    for e in entries:
      print(e.get("type"), e.get("path"), e.get("size"))
  except Exception as ex:
    print("===", mid, "ERR", ex)
# also list FanzCEO
try:
  req=urllib.request.Request("https://huggingface.co/api/models/FanzCEO/NSFW-MASTER-Z-IMAGE-TURBO/tree/main", headers={"User-Agent":"x"})
  with urllib.request.urlopen(req, timeout=60) as r:
    print("=== FanzCEO", json.loads(r.read().decode()))
except Exception as ex:
  print("FanzCEO", ex)
try:
  req=urllib.request.Request("https://huggingface.co/api/models/thutes-gbr25/NSFW-MASTER-Z-IMAGE-TURBO/tree/main", headers={"User-Agent":"x"})
  with urllib.request.urlopen(req, timeout=60) as r:
    print("=== thutes", json.loads(r.read().decode()))
except Exception as ex:
  print("thutes", ex)
PY
''',
        timeout=180,
    )
    print(so.read().decode("utf-8", errors="replace")[:5000])

    stdin, stdout, stderr = c.exec_command(
        "nohup /work/ai/venv/bin/python3 -u /tmp/install_loras.py >/work/INSTALL_LORAS.nohup 2>&1 & echo PID=$!; sleep 4; pgrep -af install_loras; head -n 40 /work/INSTALL_LORAS.log",
        get_pty=True,
        timeout=40,
    )
    print(stdout.read().decode("utf-8", errors="replace"))
    c.close()


if __name__ == "__main__":
    main()
