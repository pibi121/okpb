#!/usr/bin/env python3
"""Queue video_bgm_mix with a real existing stitched clip + real BGM via API, then verify audio actually contains BGM."""
from pathlib import Path
import sys
import paramiko

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
KEY = Path(r"C:\Users\Олег\Downloads\metalnode_id_ed25519 (5).txt")

PROMPT = {
    "1": {
        "class_type": "VHS_LoadVideoPath",
        "inputs": {
            "video": "/work/ComfyUI/output/Stitch/autoedit_00002-audio.mp4",
            "force_rate": 0,
            "custom_width": 0,
            "custom_height": 0,
            "frame_load_cap": 0,
            "skip_first_frames": 0,
            "select_every_nth": 1,
        },
    },
    "2": {
        "class_type": "VHS_LoadAudio",
        "inputs": {
            "audio_file": "/work/ComfyUI/output/audio/bgm_sensual_00003.flac",
            "seek_seconds": 0.0,
            "duration": 0.0,
        },
    },
    "3": {
        "class_type": "DJ_VideoAudioMixer",
        "inputs": {
            "images1": ["1", 0],
            "video_info1": ["1", 3],
            "audio1": ["1", 2],
            "bgm": ["2", 0],
            "bgm_mode": "all",
            "bgm_volume": 0.5,
            "fade_in_sec": 1.0,
            "fade_out_sec": 1.5,
            "audio_match_method": "repeat_audio",
        },
    },
    "4": {
        "class_type": "VHS_VideoCombine",
        "inputs": {
            "images": ["3", 0],
            "audio": ["3", 1],
            "frame_rate": 24,
            "loop_count": 0,
            "filename_prefix": "Final/bgm_patch_verify",
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
    data=json.dumps({"prompt": prompt, "client_id": "dj_mixer_verify"}).encode(),
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

if prompt_id:
    for i in range(60):
        time.sleep(3)
        h = json.loads(urllib.request.urlopen(f"http://127.0.0.1:8188/history/{prompt_id}", timeout=20).read())
        if prompt_id in h:
            st = h[prompt_id].get("status", {})
            if st.get("completed") is not None:
                print("STATUS", st.get("status_str"))
                if st.get("status_str") == "error":
                    for m in st.get("messages", []):
                        if m[0] == "execution_error":
                            print("EXC", m[1].get("exception_message"))
                            print("TB", "".join(m[1].get("traceback", []))[-2500:])
                else:
                    print("OUTPUTS", json.dumps(h[prompt_id].get("outputs", {}))[:800])
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
    with sftp.file("/work/_dj_mixer_verify.py", "w") as f:
        f.write(REMOTE % repr(PROMPT))
    sftp.close()
    stdin, stdout, stderr = client.exec_command("python3 /work/_dj_mixer_verify.py", timeout=180)
    print(stdout.read().decode(errors="replace"))
    err = stderr.read().decode(errors="replace")
    if err.strip():
        print("STDERR:", err[-3000:])
    client.close()


if __name__ == "__main__":
    main()
