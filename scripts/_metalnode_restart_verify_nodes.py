#!/usr/bin/env python3
"""Cleanup bad clones, restart Comfy, verify required node types."""
from pathlib import Path
import json
import paramiko
import time
import sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
KEY = Path(r"C:\Users\Олег\Desktop\Проект Х\peachbitch\metalnode_id_ed25519")
OUT = Path(r"C:\Users\Олег\Desktop\Проект Х\peachbitch\scripts\_verify_nodes_out.txt")

NEEDED = [
    "Anything Everywhere",
    "Blur",
    "ChromaticAberration",
    "ColorCorrect",
    "FaceDetailer",
    "Fast Groups Bypasser (rgthree)",
    "FilmGrain",
    "FluxResolutionNode",
    "GetNode",
    "Image Bloom Filter",
    "Image Comparer (rgthree)",
    "Image Lucy Sharpen",
    "ImageCASharpening+",
    "ImageResize+",
    "Lora Loader Stack (rgthree)",
    "Power Lora Loader (rgthree)",
    "SAMLoader",
    "SeedVR2LoadDiTModel",
    "SeedVR2LoadVAEModel",
    "SeedVR2VideoUpscaler",
    "SetNode",
    "UltralyticsDetectorProvider",
    "ttN text",
]


def main():
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    pkey = paramiko.Ed25519Key.from_private_key_file(str(KEY))
    c.connect("77.94.203.13", port=22024, username="root", pkey=pkey, timeout=60, allow_agent=False, look_for_keys=False)
    c.get_transport().set_keepalive(20)

    # cleanup empty/wrong ControlAltAI from first installer
    _, so, _ = c.exec_command(
        r'''
# remove failed wrong-named ControlAltAI if it has no flux node
python3 - <<'PY'
from pathlib import Path
import shutil
bad = Path("/work/ComfyUI/custom_nodes/ComfyUI-ControlAltAI-Nodes")
good = Path("/work/ComfyUI/custom_nodes/ControlAltAI-Nodes")
print("good exists", good.exists(), list(good.glob("*.py"))[:5] if good.exists() else None)
if bad.exists():
    files = list(bad.rglob("*.py"))
    print("bad py count", len(files))
    if len(files) < 2:
        shutil.rmtree(bad)
        print("removed bad ControlAltAI")
    else:
        print("keeping bad (has code)")
# ensure start script has --enable-manager
p = Path("/work/bin/start-comfy.sh")
txt = p.read_text()
print("start script:", txt)
if "--enable-manager" not in txt:
    txt = txt.replace("exec python main.py --listen --port 8188",
                     "exec python main.py --listen --port 8188 --enable-manager")
    p.write_text(txt)
    print("patched start script")
else:
    print("manager flag already present")
PY
''',
        timeout=30,
    )
    print(so.read().decode("utf-8", errors="replace"))

    # restart comfy via tmux/watchdog: kill main.py, watchdog should restart
    _, so, _ = c.exec_command(
        r'''
# soft restart
tmux kill-session -t comfy 2>/dev/null || true
pkill -f "python main.py" || true
sleep 2
# start fresh
tmux new-session -d -s comfy /work/bin/start-comfy.sh
# also poke watchdog
sleep 5
pgrep -af "main.py|comfy" | head -20
# wait for HTTP
for i in $(seq 1 40); do
  code=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8188/ || true)
  if [ "$code" = "200" ]; then echo UP_$i; break; fi
  sleep 2
done
curl -s -o /dev/null -w "final=%{http_code}\n" http://127.0.0.1:8188/
''',
        timeout=120,
    )
    print(so.read().decode("utf-8", errors="replace"))

    # wait a bit more for custom nodes to load
    time.sleep(15)

    _, so, _ = c.exec_command(
        "curl -s http://127.0.0.1:8188/object_info | /work/ai/venv/bin/python3 -c "
        "'import sys,json; d=json.load(sys.stdin); print(\"\\n\".join(sorted(d.keys())))'",
        timeout=120,
    )
    keys = so.read().decode("utf-8", errors="replace").splitlines()
    keyset = set(keys)

    lines = [f"total_nodes={len(keys)}", ""]
    missing = []
    for n in NEEDED:
        ok = n in keyset
        lines.append(("OK   " if ok else "MISS ") + n)
        if not ok:
            missing.append(n)

    # fuzzy hints for missing
    if missing:
        lines.append("")
        lines.append("fuzzy:")
        for m in missing:
            hits = [k for k in keys if m.lower().replace(" ", "") in k.lower().replace(" ", "") or m.split()[0].lower() in k.lower()]
            lines.append(f"  {m} -> {hits[:8]}")

    # import errors from comfy log if any
    _, so, _ = c.exec_command(
        "ls -lt /tmp/comfy*.log /work/ComfyUI/user/*.log 2>/dev/null | head; "
        "tmux capture-pane -t comfy -p -S -80 2>/dev/null | tail -n 60",
        timeout=30,
    )
    lines.append("")
    lines.append("=== comfy pane ===")
    lines.append(so.read().decode("utf-8", errors="replace"))

    OUT.write_text("\n".join(lines), encoding="utf-8")
    print(OUT.read_text(encoding="utf-8")[:4000])
    c.close()


if __name__ == "__main__":
    main()
