#!/usr/bin/env python3
"""Probe Metalnode: Comfy alive, custom_nodes, key models."""
from pathlib import Path
import sys
import paramiko

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

HOST = "77.94.203.13"
PORT = 22022
KEY = Path(r"C:\Users\Олег\Downloads\metalnode_id_ed25519 (5).txt")
USER = "root"

REMOTE = r'''
import json, urllib.request, os, subprocess
print("=== COMFY ===")
try:
    r = urllib.request.urlopen("http://127.0.0.1:8188/system_stats", timeout=10)
    print("OK", r.status)
except Exception as e:
    print("FAIL", e)

print("\n=== CUSTOM NODES (relevant) ===")
base = "/work/ComfyUI/custom_nodes"
want = ["Video", "Workbench", "Easy-Media", "FFmpeg", "Ace", "ACE", "Heart", "StableAudio", "DJ_Video", "Audio", "mmaudio", "MMAudio", "VHS", "VideoHelper"]
for name in sorted(os.listdir(base)):
    low = name.lower()
    if any(w.lower() in low for w in want) or "audio" in low or "ffmpeg" in low or "ace" in low or "music" in low:
        print(name)

print("\n=== OBJECT_INFO KEYWORDS ===")
try:
    data = json.loads(urllib.request.urlopen("http://127.0.0.1:8188/object_info", timeout=30).read())
    keys = list(data.keys())
    for pat in ["AutoEdit", "Workbench", "mergeVideo", "AceStep", "ACEStep", "TextEncodeAce", "DJ_Video", "VideoAudioMixer", "StableAudio", "HeartMuLa", "LoadAudio", "MiniMaxH3Reference"]:
        hits = [k for k in keys if pat.lower() in k.lower()]
        print(pat, "->", hits[:8] if hits else "NONE")
except Exception as e:
    print("object_info fail", e)

print("\n=== DISK / MODELS AUDIO ===")
for p in ["/work/ComfyUI/models/checkpoints", "/work/ComfyUI/models/audio_checkpoints", "/work/ComfyUI/models/diffusion_models", "/work/ComfyUI/models/TTS"]:
    if os.path.isdir(p):
        print(p, "exists")
        # list ace/stable related
        for root, dirs, files in os.walk(p):
            for f in files:
                fl = f.lower()
                if "ace" in fl or "stable" in fl or "heart" in fl:
                        print(" ", os.path.join(root, f)[:120], os.path.getsize(os.path.join(root,f))//1024//1024, "MB")
            # don't walk forever
            if root.count(os.sep) - p.count(os.sep) > 2:
                dirs.clear()

print("\n=== FFMPEG ===")
print(subprocess.getoutput("which ffmpeg; ffmpeg -version 2>&1 | head -1"))
print("\n=== COMFY VERSION ===")
print(subprocess.getoutput("cd /work/ComfyUI && git rev-parse --short HEAD; cat /work/ComfyUI/comfyui_version.py 2>/dev/null | head -5"))
'''


def main():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    pkey = paramiko.Ed25519Key.from_private_key_file(str(KEY))
    client.connect(HOST, port=PORT, username=USER, pkey=pkey, timeout=30, allow_agent=False, look_for_keys=False)
    sftp = client.open_sftp()
    with sftp.file("/work/_probe_stack.py", "w") as f:
        f.write(REMOTE)
    sftp.close()
    stdin, stdout, stderr = client.exec_command("python3 /work/_probe_stack.py", timeout=60)
    print(stdout.read().decode(errors="replace"))
    err = stderr.read().decode(errors="replace")
    if err.strip():
        print("STDERR:", err[:2000])
    client.close()


if __name__ == "__main__":
    main()
