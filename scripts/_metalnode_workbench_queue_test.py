#!/usr/bin/env python3
"""Actually queue the stitch_autoedit workflow via API and check for real errors."""
from pathlib import Path
import sys
import paramiko

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
KEY = Path(r"C:\Users\Олег\Downloads\metalnode_id_ed25519 (5).txt")

PROMPT = {
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
            "limit_duration_sec": 15.0,
        },
    },
    "2": {
        "class_type": "VHS_VideoCombine",
        "inputs": {
            "images": ["1", 0],
            "audio": ["1", 1],
            "frame_rate": ["1", 2],
            "loop_count": 0,
            "filename_prefix": "Stitch/autoedit_test",
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
prompt = %s
req = urllib.request.Request(
    "http://127.0.0.1:8188/prompt",
    data=json.dumps({"prompt": prompt, "client_id": "workbench_test"}).encode(),
    headers={"Content-Type": "application/json"},
)
try:
    resp = urllib.request.urlopen(req, timeout=30)
    result = json.loads(resp.read())
    print("SUBMIT_OK", json.dumps(result)[:500])
    prompt_id = result.get("prompt_id")
except urllib.error.HTTPError as e:
    print("HTTP", e.code, e.read().decode(errors="replace")[:4000])
    prompt_id = None
except Exception as e:
    print("ERR", repr(e))
    prompt_id = None

if prompt_id:
    for i in range(60):
        time.sleep(3)
        h = json.loads(urllib.request.urlopen(f"http://127.0.0.1:8188/history/{prompt_id}", timeout=20).read())
        if prompt_id in h:
            st = h[prompt_id].get("status", {})
            print(f"[{(i+1)*3}s]", st.get("status_str"), "completed=", st.get("completed"))
            if st.get("completed") is not None:
                print("OUTPUTS", json.dumps(h[prompt_id].get("outputs", {}))[:1500])
                if st.get("status_str") == "error":
                    for m in st.get("messages", []):
                        if m[0] == "execution_error":
                            print("EXC_NODE", m[1].get("node_id"), m[1].get("node_type"))
                            print("EXC", m[1].get("exception_message"))
                            print("TB", "".join(m[1].get("traceback", []))[-3000:])
                break
    else:
        print("TIMEOUT")
'''


def main():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    pkey = paramiko.Ed25519Key.from_private_key_file(str(KEY))
    client.connect("77.94.203.13", port=22022, username="root", pkey=pkey, timeout=30, allow_agent=False, look_for_keys=False)
    sftp = client.open_sftp()
    with sftp.file("/work/_workbench_queue_test.py", "w") as f:
        f.write(REMOTE % repr(PROMPT))
    sftp.close()
    stdin, stdout, stderr = client.exec_command("python3 /work/_workbench_queue_test.py", timeout=300)
    print(stdout.read().decode(errors="replace"))
    err = stderr.read().decode(errors="replace")
    if err.strip():
        print("STDERR:", err[-2000:])
    client.close()


if __name__ == "__main__":
    main()
