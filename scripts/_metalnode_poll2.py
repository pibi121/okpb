#!/usr/bin/env python3
from pathlib import Path
import sys, paramiko
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
KEY = Path(r"C:\Users\Олег\Downloads\metalnode_id_ed25519 (5).txt")
REMOTE = r'''
import os, subprocess
partial="/work/ComfyUI/models/checkpoints/ace_step_1.5_turbo_aio.safetensors.partial"
final="/work/ComfyUI/models/checkpoints/ace_step_1.5_turbo_aio.safetensors"
for p in (final, partial):
  if os.path.exists(p):
    print(f"{p} {os.path.getsize(p)/1e9:.2f}GB")
pid=open("/work/_ace_dl.pid").read().strip() if os.path.exists("/work/_ace_dl.pid") else ""
alive=subprocess.getoutput(f"ps -p {pid} -o pid=").strip() if pid else ""
print("alive", bool(alive), "pid", pid)
# VHS combine schema
import json, urllib.request
data=json.loads(urllib.request.urlopen("http://127.0.0.1:8188/object_info/VHS_VideoCombine", timeout=20).read())
info=data["VHS_VideoCombine"]
print("VHS required", list(info["input"]["required"].keys()))
print("VHS optional", list(info["input"].get("optional",{}).keys())[:20])
# AutoEdit outputs
data2=json.loads(urllib.request.urlopen("http://127.0.0.1:8188/object_info/AutoEditWorkbench", timeout=20).read())
print("AutoEdit outs", data2["AutoEditWorkbench"].get("output"), data2["AutoEditWorkbench"].get("output_name"))
data3=json.loads(urllib.request.urlopen("http://127.0.0.1:8188/object_info/DJ_VideoAudioMixer", timeout=20).read())
print("DJ outs", data3["DJ_VideoAudioMixer"].get("output"), data3["DJ_VideoAudioMixer"].get("output_name"))
# VHS LoadVideo
data4=json.loads(urllib.request.urlopen("http://127.0.0.1:8188/object_info/VHS_LoadVideo", timeout=20).read())
print("LoadVideo outs", data4["VHS_LoadVideo"].get("output"), data4["VHS_LoadVideo"].get("output_name"))
'''
c=paramiko.SSHClient(); c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
pkey=paramiko.Ed25519Key.from_private_key_file(str(KEY))
c.connect("77.94.203.13", port=22022, username="root", pkey=pkey, timeout=30, allow_agent=False, look_for_keys=False)
sftp=c.open_sftp(); f=sftp.file("/work/_poll2.py","w"); f.write(REMOTE); f.close(); sftp.close()
stdin,stdout,stderr=c.exec_command("python3 /work/_poll2.py", timeout=30)
print(stdout.read().decode(errors="replace"))
c.close()
