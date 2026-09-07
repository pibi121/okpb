#!/usr/bin/env python3
"""Smoke-test ACE-Step BGM via Comfy API (short 8s instrumental)."""
from pathlib import Path
import sys
import paramiko

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
KEY = Path(r"C:\Users\Олег\Downloads\metalnode_id_ed25519 (5).txt")

PROMPT = {
    "1": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": "ace_step_1.5_turbo_aio.safetensors"}},
    "2": {
        "class_type": "TextEncodeAceStepAudio1.5",
        "inputs": {
            "clip": ["1", 1],
            "tags": "slow sensual R&B, soft bass, intimate, warm pads, quiet instrumental, no vocals",
            "lyrics": "[inst]",
            "seed": 42,
            "bpm": 78,
            "duration": 8.0,
            "timesignature": "4",
            "language": "en",
            "keyscale": "C minor",
            "generate_audio_codes": True,
            "cfg_scale": 2.0,
            "temperature": 0.85,
            "top_p": 0.9,
            "top_k": 0,
            "min_p": 0.0,
        },
    },
    "3": {"class_type": "CLIPTextEncode", "inputs": {"clip": ["1", 1], "text": ""}},
    "4": {"class_type": "ConditioningZeroOut", "inputs": {"conditioning": ["3", 0]}},
    "5": {"class_type": "EmptyAceStep1.5LatentAudio", "inputs": {"seconds": 8.0, "batch_size": 1}},
    "6": {
        "class_type": "KSampler",
        "inputs": {
            "model": ["1", 0],
            "positive": ["2", 0],
            "negative": ["4", 0],
            "latent_image": ["5", 0],
            "seed": 42,
            "steps": 8,
            "cfg": 1.0,
            "sampler_name": "euler",
            "scheduler": "simple",
            "denoise": 1.0,
        },
    },
    "7": {"class_type": "VAEDecodeAudio", "inputs": {"samples": ["6", 0], "vae": ["1", 2]}},
    "8": {"class_type": "SaveAudio", "inputs": {"audio": ["7", 0], "filename_prefix": "audio/bgm_smoke_test"}},
}

REMOTE = r'''
import json, urllib.request, time
prompt = %s
req = urllib.request.Request(
    "http://127.0.0.1:8188/prompt",
    data=json.dumps({"prompt": prompt, "client_id": "ace_smoke"}).encode(),
    headers={"Content-Type": "application/json"},
)
try:
    resp = urllib.request.urlopen(req, timeout=30)
    result = json.loads(resp.read())
    print("SUBMIT_OK", json.dumps(result)[:500])
    prompt_id = result.get("prompt_id")
except urllib.error.HTTPError as e:
    print("HTTP", e.code, e.read().decode(errors="replace")[:3000])
    prompt_id = None
except Exception as e:
    print("ERR", repr(e))
    prompt_id = None

if prompt_id:
    for i in range(90):
        time.sleep(4)
        h = json.loads(urllib.request.urlopen(f"http://127.0.0.1:8188/history/{prompt_id}", timeout=20).read())
        if prompt_id in h:
            st = h[prompt_id].get("status", {})
            print(f"[{(i+1)*4}s]", st.get("status_str"), "completed=", st.get("completed"))
            if st.get("completed") is not None:
                print("OUTPUTS", json.dumps(h[prompt_id].get("outputs", {}))[:1500])
                if st.get("status_str") == "error":
                    for m in st.get("messages", []):
                        if m[0] == "execution_error":
                            print("EXC", m[1].get("exception_message"))
                            print("TB", "".join(m[1].get("traceback", []))[-2500:])
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
    with sftp.file("/work/_ace_smoke.py", "w") as f:
        f.write(REMOTE % repr(PROMPT))
    sftp.close()
    stdin, stdout, stderr = client.exec_command("python3 /work/_ace_smoke.py", timeout=420)
    print(stdout.read().decode(errors="replace"))
    err = stderr.read().decode(errors="replace")
    if err.strip():
        print("STDERR:", err[-2000:])
    client.close()


if __name__ == "__main__":
    main()
