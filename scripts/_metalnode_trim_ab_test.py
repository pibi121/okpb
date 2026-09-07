#!/usr/bin/env python3
"""Queue AutoEditWorkbench twice (trim_start=False vs True) on the real stitch_inbox clips, compare durations."""
from pathlib import Path
import sys
import paramiko

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
KEY = Path(r"C:\Users\Олег\Downloads\metalnode_id_ed25519 (5).txt")


def make_prompt(trim_start, trim_start_sec, prefix):
    return {
        "1": {
            "class_type": "AutoEditWorkbench",
            "inputs": {
                "directory_path": "/work/ComfyUI/output/stitch_inbox",
                "sort_strategy": "alphabetical_asc",
                "resize_mode": "Crop (Fill Screen)",
                "resolution_strategy": "First Video",
                "custom_width": 512,
                "custom_height": 512,
                "fps_strategy": "First Video",
                "custom_fps": 24,
                "limit_duration_sec": 0.0,
                "trim_start": trim_start,
                "trim_start_sec": trim_start_sec,
            },
        },
        "2": {
            "class_type": "VHS_VideoCombine",
            "inputs": {
                "images": ["1", 0],
                "audio": ["1", 1],
                "frame_rate": ["1", 2],
                "loop_count": 0,
                "filename_prefix": prefix,
                "format": "video/h264-mp4",
                "pix_fmt": "yuv420p",
                "crf": 19,
                "save_metadata": True,
                "pingpong": False,
                "save_output": True,
            },
        },
    }


REMOTE = r'''
import json, urllib.request, time

def submit(prompt, cid):
    req = urllib.request.Request(
        "http://127.0.0.1:8188/prompt",
        data=json.dumps({"prompt": prompt, "client_id": cid}).encode(),
        headers={"Content-Type": "application/json"},
    )
    try:
        r = json.loads(urllib.request.urlopen(req, timeout=30).read())
        return r.get("prompt_id")
    except urllib.error.HTTPError as e:
        print("HTTP", e.code, e.read().decode(errors="replace")[:3000])
        return None

def wait(pid, label):
    for i in range(60):
        time.sleep(3)
        h = json.loads(urllib.request.urlopen(f"http://127.0.0.1:8188/history/{pid}", timeout=20).read())
        if pid in h:
            st = h[pid].get("status", {})
            if st.get("completed") is not None:
                print(label, st.get("status_str"))
                if st.get("status_str") == "error":
                    for m in st.get("messages", []):
                        if m[0] == "execution_error":
                            print(label, "EXC", m[1].get("exception_message"))
                else:
                    outs = h[pid].get("outputs", {})
                    print(label, "OUTPUTS", json.dumps(outs)[:800])
                return
    print(label, "TIMEOUT")

pA = %s
pB = %s

pidA = submit(pA, "trim_off_test")
print("submitted A (trim_start=False):", pidA)
if pidA:
    wait(pidA, "A(no-trim)")

pidB = submit(pB, "trim_on_test")
print("submitted B (trim_start=True, 1.5s):", pidB)
if pidB:
    wait(pidB, "B(trim-1.5s)")
'''


def main():
    a = make_prompt(False, 1.5, "Stitch/trimtest_off")
    b = make_prompt(True, 1.5, "Stitch/trimtest_on")

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    pkey = paramiko.Ed25519Key.from_private_key_file(str(KEY))
    client.connect("77.94.203.13", port=22022, username="root", pkey=pkey, timeout=30, allow_agent=False, look_for_keys=False)
    sftp = client.open_sftp()
    with sftp.file("/work/_trim_ab_test.py", "w") as f:
        f.write(REMOTE % (repr(a), repr(b)))
    sftp.close()
    stdin, stdout, stderr = client.exec_command("python3 /work/_trim_ab_test.py", timeout=200)
    print(stdout.read().decode(errors="replace"))
    err = stderr.read().decode(errors="replace")
    if err.strip():
        print("STDERR:", err[-2000:])
    client.close()


if __name__ == "__main__":
    main()
