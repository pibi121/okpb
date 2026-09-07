#!/usr/bin/env python3
"""Diagnose why final mixed video has no BGM: check output file, ffprobe streams, recent history, and DJ_VideoAudioMixer source."""
from pathlib import Path
import sys
import paramiko

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
KEY = Path(r"C:\Users\Олег\Downloads\metalnode_id_ed25519 (5).txt")

REMOTE = r'''
echo "=== output/Final listing ==="
ls -lat /work/ComfyUI/output/Final/ | head -10

echo "=== output/audio listing ==="
ls -lat /work/ComfyUI/output/audio/ | head -10

echo "=== ffprobe latest Final mp4 ==="
LATEST=$(ls -t /work/ComfyUI/output/Final/*.mp4 2>/dev/null | head -1)
echo "Latest: $LATEST"
if [ -n "$LATEST" ]; then
  ffprobe -v error -show_entries stream=index,codec_type,codec_name,duration,channels -of default=noprint_wrappers=0 "$LATEST"
fi

echo "=== recent history (last 5 prompts) ==="
python3 - <<'PY'
import json, urllib.request
h = json.loads(urllib.request.urlopen("http://127.0.0.1:8188/history?max_items=5", timeout=20).read())
for pid, item in list(h.items())[:5]:
    st = item.get("status", {})
    prompt = item.get("prompt", [None, None, {}])
    nodes = prompt[2] if len(prompt) > 2 else {}
    print("----", pid, st.get("status_str"), st.get("completed"))
    for nid, nd in nodes.items():
        ct = nd.get("class_type", "")
        if ct in ("VHS_LoadAudio", "LoadAudio", "DJ_VideoAudioMixer", "VHS_LoadVideo", "VHS_LoadVideoPath"):
            print("  node", nid, ct, nd.get("inputs"))
PY
'''

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
pkey = paramiko.Ed25519Key.from_private_key_file(str(KEY))
c.connect("77.94.203.13", port=22022, username="root", pkey=pkey, timeout=30, allow_agent=False, look_for_keys=False)
sftp = c.open_sftp()
with sftp.file("/work/_diag_bgm_mix.sh", "w") as f:
    f.write(REMOTE)
sftp.close()
stdin, stdout, stderr = c.exec_command("bash /work/_diag_bgm_mix.sh", timeout=40)
print(stdout.read().decode(errors="replace"))
err = stderr.read().decode(errors="replace")
if err.strip():
    print("STDERR:", err[-2000:])
c.close()
