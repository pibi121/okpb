#!/usr/bin/env python3
"""Dump Workbench/DJ mixer INPUT_TYPES + ACE native node specs; poll ACE download."""
from pathlib import Path
import sys
import paramiko

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

HOST = "77.94.203.13"
PORT = 22022
KEY = Path(r"C:\Users\Олег\Downloads\metalnode_id_ed25519 (5).txt")
USER = "root"

REMOTE = r'''
import ast, pathlib, json, urllib.request, os, subprocess

# --- download progress ---
partial = "/work/ComfyUI/models/checkpoints/ace_step_1.5_turbo_aio.safetensors.partial"
final = "/work/ComfyUI/models/checkpoints/ace_step_1.5_turbo_aio.safetensors"
for p in (final, partial):
    if os.path.exists(p):
        print(f"FILE {p} {os.path.getsize(p)/1e9:.2f} GB")
pidf = "/work/_ace_dl.pid"
if os.path.exists(pidf):
    pid = open(pidf).read().strip()
    alive = subprocess.getoutput(f"ps -p {pid} -o pid= || true").strip()
    print("DL_PID", pid, "alive" if alive else "dead")
    print("DL_LOG_TAIL:")
    print(subprocess.getoutput("tail -5 /work/_ace_dl.log"))

# --- INPUT_TYPES from source ---
def dump_inputs(path, classname):
    src = pathlib.Path(path).read_text(errors="replace")
    # crude extract of INPUT_TYPES return dict by printing function body lines
    print(f"\n=== {classname} from {path} ===")
    lines = src.splitlines()
    in_cls = False
    in_it = False
    depth = 0
    buf = []
    for i, line in enumerate(lines):
        if line.startswith(f"class {classname}"):
            in_cls = True
        if in_cls and "def INPUT_TYPES" in line:
            in_it = True
        if in_it:
            buf.append(line)
            if "{" in line:
                depth += line.count("{") - line.count("}")
            elif "}" in line:
                depth += line.count("{") - line.count("}")
            # start counting after first {
            if len(buf) > 2 and depth <= 0 and any("{" in b for b in buf):
                break
            if len(buf) > 80:
                break
    print("\n".join(buf[:80]))

dump_inputs("/work/ComfyUI/custom_nodes/ComfyUI-Video-Workbench/video_workbench.py", "AutoEditWorkbench")
dump_inputs("/work/ComfyUI/custom_nodes/DJ_VideoAudioMixer/video_audio_mixer.py", "DJ_VideoAudioMixer")

# ACE native nodes (already in core)
print("\n=== ACE OBJECT_INFO ===")
try:
    data = json.loads(urllib.request.urlopen("http://127.0.0.1:8188/object_info", timeout=30).read())
    for name in ["TextEncodeAceStepAudio1.5", "EmptyAceStep1.5LatentAudio", "TextEncodeAceStepAudio", "EmptyAceStepLatentAudio", "CheckpointLoaderSimple", "VAEDecodeAudio", "SaveAudio", "KSampler", "CLIPTextEncode"]:
        if name in data:
            info = data[name]
            print(f"\n-- {name} --")
            print("required:", list(info.get("input", {}).get("required", {}).keys()))
            print("optional:", list(info.get("input", {}).get("optional", {}).keys()))
            print("output:", info.get("output"), info.get("output_name"))
            # print widget defaults for interesting ones
            req = info.get("input", {}).get("required", {})
            for k, v in req.items():
                if isinstance(v, list) and len(v) >= 2 and isinstance(v[1], dict):
                    print(f"  {k}: default={v[1].get('default')} type0={v[0] if not isinstance(v[0], list) else 'COMBO'}")
                elif isinstance(v, list) and v and isinstance(v[0], list):
                    print(f"  {k}: combo sample={v[0][:5]}...")
        else:
            print(f"MISSING {name}")
except Exception as e:
    print("fail", e)
'''


def main():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    pkey = paramiko.Ed25519Key.from_private_key_file(str(KEY))
    client.connect(HOST, port=PORT, username=USER, pkey=pkey, timeout=30, allow_agent=False, look_for_keys=False)
    sftp = client.open_sftp()
    with sftp.file("/work/_schemas_poll.py", "w") as f:
        f.write(REMOTE)
    sftp.close()
    stdin, stdout, stderr = client.exec_command("python3 /work/_schemas_poll.py", timeout=60)
    print(stdout.read().decode(errors="replace"))
    err = stderr.read().decode(errors="replace")
    if err.strip():
        print("STDERR:", err[-1500:])
    client.close()


if __name__ == "__main__":
    main()
