#!/usr/bin/env python3
from pathlib import Path
import paramiko
import sys
import time
import json

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.stdout.reconfigure(line_buffering=True)

KEY = Path(r"C:\Users\Олег\Downloads\metalnode_id_ed25519 (1).txt")
PY = Path(__file__).with_name("_metalnode_hf_redownload_klein.py")
EXPECT = "865ba09f5b4c3cbd3468a4bd3acb9fcb2f8740c54317482f0bcd4ed1d3655cee"


def connect():
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    pkey = paramiko.Ed25519Key.from_private_key_file(str(KEY))
    c.connect(
        "77.94.203.13",
        port=22024,
        username="root",
        pkey=pkey,
        timeout=90,
        allow_agent=False,
        look_for_keys=False,
        banner_timeout=90,
    )
    return c


def run(c, cmd, timeout=120):
    _, so, se = c.exec_command(cmd, timeout=timeout)
    return so.read().decode("utf-8", errors="replace"), se.read().decode(
        "utf-8", errors="replace"
    )


def main():
    c = connect()
    sftp = c.open_sftp()
    sftp.put(str(PY), "/tmp/hf_redownload_klein.py")
    sftp.close()

    run(c, "pkill -f 'aria2c.*flux-2-klein' || true; pkill -f hf_redownload_klein || true; sleep 1")
    out, _ = run(
        c,
        "nohup /work/ai/venv/bin/python3 -u /tmp/hf_redownload_klein.py > /work/REDOWNLOAD_KLEIN_HF.log 2>&1 & echo PID:$!; sleep 2; head -20 /work/REDOWNLOAD_KLEIN_HF.log",
        timeout=30,
    )
    print(out, flush=True)

    for i in range(150):
        time.sleep(20)
        out, _ = run(
            c,
            "tail -15 /work/REDOWNLOAD_KLEIN_HF.log; ls -lh /work/ComfyUI/models/diffusion_models/flux-2-klein-9b-fp8.safetensors 2>/dev/null; pgrep -af hf_redownload_klein | head -3",
            timeout=30,
        )
        print(f"=== {i} ===", flush=True)
        print(out[-1000:], flush=True)
        if "READY" in out:
            break
        if "AssertionError" in out or "Traceback" in out:
            print("FAIL", flush=True)
            c.close()
            return
    else:
        print("TIMEOUT", flush=True)
        c.close()
        return

    # verify sha on disk
    out, _ = run(
        c,
        f"sha256sum /work/ComfyUI/models/diffusion_models/flux-2-klein-9b-fp8.safetensors",
        timeout=180,
    )
    print("DISK_SHA", out, flush=True)
    if EXPECT not in out:
        print("SHA_STILL_BAD", flush=True)
        c.close()
        return

    # queue test generation
    api_prompt = {
        "126": {
            "class_type": "UNETLoader",
            "inputs": {
                "unet_name": "flux-2-klein-9b-fp8.safetensors",
                "weight_dtype": "default",
            },
        },
        "136": {
            "class_type": "CLIPLoader",
            "inputs": {
                "clip_name": "qwen_3_8b_fp8mixed.safetensors",
                "type": "flux2",
                "device": "default",
            },
        },
        "102": {
            "class_type": "VAELoader",
            "inputs": {"vae_name": "flux2-vae.safetensors"},
        },
        "105": {
            "class_type": "EmptyFlux2LatentImage",
            "inputs": {"width": 1024, "height": 1024, "batch_size": 1},
        },
        "107": {
            "class_type": "CLIPTextEncode",
            "inputs": {
                "text": "a candid smartphone photo of a red apple on a wooden table, natural daylight",
                "clip": ["136", 0],
            },
        },
        "100": {
            "class_type": "FluxGuidance",
            "inputs": {"conditioning": ["107", 0], "guidance": 4.0},
        },
        "135": {
            "class_type": "ConditioningZeroOut",
            "inputs": {"conditioning": ["107", 0]},
        },
        "134": {
            "class_type": "KSampler",
            "inputs": {
                "seed": 42,
                "steps": 4,
                "cfg": 1.0,
                "sampler_name": "euler",
                "scheduler": "simple",
                "denoise": 1.0,
                "model": ["126", 0],
                "positive": ["100", 0],
                "negative": ["135", 0],
                "latent_image": ["105", 0],
            },
        },
        "104": {
            "class_type": "VAEDecode",
            "inputs": {"samples": ["134", 0], "vae": ["102", 0]},
        },
        "9": {
            "class_type": "SaveImage",
            "inputs": {"images": ["104", 0], "filename_prefix": "klein_test"},
        },
    }
    payload = json.dumps({"prompt": api_prompt})
    sftp = c.open_sftp()
    with sftp.file("/tmp/klein_test_prompt.json", "w") as f:
        f.write(payload)
    sftp.close()

    out, _ = run(
        c,
        r"""
export PATH=/usr/bin:/bin
if ! curl -s -m 3 http://127.0.0.1:8188/system_stats >/dev/null; then
  cd /work/ComfyUI
  nohup /work/ai/venv/bin/python main.py --listen --port 8188 --enable-manager >> /work/ComfyUI/user/comfyui_8188.log 2>&1 &
  for i in 1 2 3 4 5 6 7 8 9 10; do
    sleep 3
    curl -s -m 3 http://127.0.0.1:8188/system_stats >/dev/null && break
  done
fi
RESP=$(curl -s -m 60 -X POST http://127.0.0.1:8188/prompt -H 'Content-Type: application/json' --data @/tmp/klein_test_prompt.json)
echo "QUEUE:$RESP"
python3 - <<'PY'
import json, time, urllib.request
from pathlib import Path
resp=json.load(open('/tmp/klein_test_prompt.json'))
# re-read queue response from env file
import subprocess, os
r=subprocess.check_output("curl -s -m 60 -X POST http://127.0.0.1:8188/prompt -H 'Content-Type: application/json' --data @/tmp/klein_test_prompt.json", shell=True)
print('raw', r[:300])
d=json.loads(r)
pid=d.get('prompt_id')
print('prompt_id', pid)
for i in range(90):
    h=json.load(urllib.request.urlopen(f'http://127.0.0.1:8188/history/{pid}', timeout=30))
    if pid in h:
        print('DONE')
        print(h[pid].get('outputs'))
        break
    time.sleep(2)
else:
    print('HIST_TIMEOUT')
imgs=sorted(Path('/work/ComfyUI/output').glob('klein_test*.png'), key=lambda p:p.stat().st_mtime, reverse=True)
print('imgs', [p.name for p in imgs[:3]])
if imgs:
    from PIL import Image
    import numpy as np
    im=Image.open(imgs[0]).convert('RGB')
    a=np.asarray(im).astype('float32')
    print('std', float(a.std()), 'mean', float(a.mean()), 'file', imgs[0].name)
    # real photo usually not pure RGB snow; noise std often ~70-80 with mean~127
    if 40 < a.std() < 85 and 100 < a.mean() < 150:
        # could still be noise; check channel correlation
        flat=a.reshape(-1,3)
        corr = np.corrcoef(flat[:,0], flat[:,1])[0,1]
        print('rg_corr', float(corr))
        print('LIKELY_NOISE' if abs(corr)<0.15 else 'LIKELY_IMAGE')
    else:
        print('LIKELY_IMAGE')
PY
tail -20 /work/ComfyUI/user/comfyui_8188.log
""",
        timeout=360,
    )
    print(out[-4000:], flush=True)
    c.close()


if __name__ == "__main__":
    main()
