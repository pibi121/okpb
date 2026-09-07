#!/usr/bin/env python3
"""Install MMAudio + MuseTalk lipsync on Metalnode; restart Comfy; write status."""
from __future__ import annotations

import sys
import time
from pathlib import Path

import paramiko

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

KEY = Path(r"C:\Users\Олег\Downloads\metalnode_id_ed25519 (2).txt")
HOST = "77.94.203.13"
PORT = 22022

REMOTE = r'''#!/usr/bin/env python3
import os, sys, time, subprocess
from pathlib import Path

LOG = Path("/work/AUDIO_STACK.log")
STATUS = Path("/work/AUDIO_STACK_STATUS.txt")
COMFY = Path("/work/ComfyUI")
CN = COMFY / "custom_nodes"
PY = "/work/ai/venv/bin/python3"
PIP = "/work/ai/venv/bin/pip"

def log(msg):
    line = f"[{time.strftime('%H:%M:%S')}] {msg}"
    print(line, flush=True)
    with LOG.open("a", encoding="utf-8") as f:
        f.write(line + "\n")

def run(cmd, check=True):
    log(f"$ {cmd[:200]}")
    r = subprocess.run(cmd, shell=True, text=True, capture_output=True)
    if r.stdout:
        print(r.stdout[-1500:], flush=True)
    if r.returncode and check:
        log(f"FAIL rc={r.returncode}: {(r.stderr or '')[-600]}")
        if check:
            raise SystemExit(r.returncode)
    return r

def dl(url, dest: Path, min_bytes=1_000_000):
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists() and dest.stat().st_size >= min_bytes:
        log(f"OK exists {dest.name} {dest.stat().st_size}")
        return True
    part = Path(str(dest) + ".part")
    log(f"DL {dest.name}")
    cmd = (
        f'curl -L --http1.1 --retry 8 --retry-delay 2 -C - '
        f'--connect-timeout 30 -o "{part}" "{url}"'
    )
    r = run(cmd, check=False)
    if not part.exists() or part.stat().st_size < min_bytes:
        log(f"MISS {dest.name} size={part.stat().st_size if part.exists() else 0}")
        STATUS.write_text(STATUS.read_text(encoding="utf-8") + f"FAIL {dest.name}\n", encoding="utf-8")
        return False
    part.rename(dest)
    log(f"OK {dest.name} {dest.stat().st_size}")
    STATUS.write_text(STATUS.read_text(encoding="utf-8") + f"OK {dest.name}\n", encoding="utf-8")
    return True

STATUS.write_text("START\n", encoding="utf-8")
log("=== AUDIO STACK ===")

# --- MMAudio node ---
mma = CN / "ComfyUI-MMAudio"
if not (mma / ".git").exists():
    run(f'git clone --depth 1 https://github.com/kijai/ComfyUI-MMAudio "{mma}"')
else:
    log("MMAudio repo OK")
run(f'{PIP} install -r "{mma}/requirements.txt"', check=False)

# --- MuseTalk KJ ---
mt = CN / "ComfyUI-MuseTalk-KJ"
if not (mt / ".git").exists():
    run(f'git clone --depth 1 https://github.com/kijai/ComfyUI-MuseTalk-KJ "{mt}"')
else:
    log("MuseTalk repo OK")
req = mt / "requirements.txt"
if req.exists():
    run(f'{PIP} install -r "{req}"', check=False)

# TTS helper for sample dialogue
run(f"{PIP} install edge-tts soundfile", check=False)

# --- MMAudio models ---
MM = COMFY / "models" / "mmaudio"
MM.mkdir(parents=True, exist_ok=True)
base = "https://huggingface.co/Kijai/MMAudio_safetensors/resolve/main"
files = [
    (MM / "mmaudio_large_44k_v2_fp16.safetensors", f"{base}/mmaudio_large_44k_v2_fp16.safetensors", 800_000_000),
    (MM / "mmaudio_vae_44k_fp16.safetensors", f"{base}/mmaudio_vae_44k_fp16.safetensors", 200_000_000),
    (MM / "mmaudio_synchformer_fp16.safetensors", f"{base}/mmaudio_synchformer_fp16.safetensors", 100_000_000),
    (MM / "apple_DFN5B-CLIP-ViT-H-14-384_fp16.safetensors", f"{base}/apple_DFN5B-CLIP-ViT-H-14-384_fp16.safetensors", 500_000_000),
]
ok_all = True
for dest, url, mn in files:
    if not dl(url, dest, mn):
        ok_all = False

# --- MuseTalk models (common layout for KJ pack) ---
# KJ often expects models under models/musetalk or downloads on first run.
# Pre-download unet + vae from TMElyralab if URLs work.
MTM = COMFY / "models" / "musetalk"
MTM.mkdir(parents=True, exist_ok=True)
# Check node for expected paths
nodes_py = list(mt.rglob("*.py"))
hint = ""
for p in nodes_py[:20]:
    try:
        t = p.read_text(encoding="utf-8", errors="ignore")
    except Exception:
        continue
    if "musetalk" in t.lower() and ("huggingface" in t.lower() or "models/" in t):
        hint += f"\n# {p.name}\n"
        for line in t.splitlines():
            if "http" in line or "models/" in line or "MuseTalk" in line:
                if len(line) < 200:
                    hint += line + "\n"
Path("/work/MUSETALK_PATH_HINTS.txt").write_text(hint[:8000], encoding="utf-8")
log("wrote MuseTalk path hints")

# Sample TTS wav for lipsync test (short English line)
sample = Path("/work/ComfyUI/input/test_dialogue_moan.mp3")
sample.parent.mkdir(parents=True, exist_ok=True)
if not sample.exists():
    # edge-tts writes mp3
    run(
        f'{PY} -m edge_tts --voice en-US-AriaNeural '
        f'--text "Oh yes... right there... don\'t stop..." '
        f'--write-media "{sample}"',
        check=False,
    )
    if sample.exists():
        log(f"sample TTS OK {sample.stat().st_size}")
        STATUS.write_text(STATUS.read_text(encoding="utf-8") + "OK sample_tts\n", encoding="utf-8")
    else:
        log("sample TTS fail — user can upload wav manually")

# Restart Comfy
log("restarting ComfyUI")
run("pkill -f 'python main.py --listen' || true", check=False)
time.sleep(3)
run(
    f'cd /work/ComfyUI && nohup {PY} main.py --listen --port 8188 --enable-manager '
    f'>/work/comfy_restart.log 2>&1 &',
    check=False,
)
time.sleep(18)
r = run("curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8188/", check=False)
log(f"comfy http={r.stdout.strip()}")

# Verify imports
run(
    f'{PY} -c "import sys; sys.path.insert(0,\'/work/ComfyUI/custom_nodes/ComfyUI-MMAudio\'); print(\'mmaudio_pkg\')"',
    check=False,
)

STATUS.write_text(STATUS.read_text(encoding="utf-8") + ("ALL_DONE\n" if ok_all else "PARTIAL\n"), encoding="utf-8")
log("DONE status=" + STATUS.read_text(encoding="utf-8")[-200:])
print("FINISHED")
'''


def main() -> None:
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    pkey = paramiko.Ed25519Key.from_private_key_file(str(KEY))
    for attempt in range(5):
        try:
            c.connect(HOST, port=PORT, username="root", pkey=pkey, timeout=40, allow_agent=False, look_for_keys=False)
            break
        except Exception as e:
            print("retry", attempt, e)
            time.sleep(3)
    else:
        raise SystemExit("ssh fail")

    sftp = c.open_sftp()
    with sftp.file("/tmp/install_audio_stack.py", "w") as f:
        f.write(REMOTE)
    sftp.chmod("/tmp/install_audio_stack.py", 0o755)
    sftp.close()

    _, so, se = c.exec_command(
        "nohup /work/ai/venv/bin/python3 -u /tmp/install_audio_stack.py > /work/AUDIO_STACK.nohup 2>&1 & echo PID:$!",
        timeout=20,
    )
    print(so.read().decode())
    print(se.read().decode())
    time.sleep(3)
    _, so, _ = c.exec_command("tail -30 /work/AUDIO_STACK.nohup; ls /work/ComfyUI/custom_nodes | grep -iE 'mmaudio|muse'", timeout=20)
    print(so.read().decode())
    c.close()


if __name__ == "__main__":
    main()
