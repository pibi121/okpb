#!/usr/bin/env python3
from pathlib import Path
import paramiko
import sys
import time
import json

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.stdout.reconfigure(line_buffering=True)

KEY = Path(r"C:\Users\Олег\Downloads\metalnode_id_ed25519 (1).txt")
SCR = Path(__file__).with_name("_metalnode_wget_klein_verify.sh")
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
    sftp.put(str(SCR), "/tmp/wget_klein_verify.sh")
    sftp.close()

    out, _ = run(
        c,
        "nohup bash /tmp/wget_klein_verify.sh > /work/REDOWNLOAD_KLEIN_WGET.nohup 2>&1 & echo PID:$!; sleep 2; cat /work/REDOWNLOAD_KLEIN_WGET.log",
        timeout=30,
    )
    print(out, flush=True)

    for i in range(200):
        time.sleep(30)
        out, _ = run(
            c,
            r"""
export PATH=/usr/bin:/bin
tail -8 /work/REDOWNLOAD_KLEIN_WGET.log
ls -lh /work/ComfyUI/models/diffusion_models/flux-2-klein-9b-fp8.safetensors* 2>/dev/null
# only count real wget for the part file
pgrep -f '/work/ComfyUI/models/diffusion_models/flux-2-klein-9b-fp8.safetensors.part' | wc -l
""",
            timeout=30,
        )
        print(f"=== {i} ===", flush=True)
        print(out[-900:], flush=True)
        if "READY" in out and EXPECT[:16] in out:
            print("DOWNLOAD_OK", flush=True)
            break
        if "SHA_MISMATCH" in out or "SIZE_MISMATCH" in out or "NO_PART" in out:
            print("DOWNLOAD_FAIL", flush=True)
            c.close()
            return
    else:
        print("TIMEOUT", flush=True)
        c.close()
        return

    # Test generation via API
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
    sftp = c.open_sftp()
    with sftp.file("/tmp/klein_test_prompt.json", "w") as f:
        f.write(json.dumps({"prompt": api_prompt}))
    sftp.close()

    out, _ = run(
        c,
        r"""
export PATH=/usr/bin:/bin
if ! curl -s -m 3 http://127.0.0.1:8188/system_stats >/dev/null; then
  cd /work/ComfyUI
  nohup /work/ai/venv/bin/python main.py --listen --port 8188 --enable-manager >> /work/ComfyUI/user/comfyui_8188.log 2>&1 &
  for i in $(seq 1 15); do sleep 2; curl -s -m 2 http://127.0.0.1:8188/system_stats >/dev/null && break; done
fi
python3 - <<'PY'
import json, time, urllib.request
from pathlib import Path
req=urllib.request.Request('http://127.0.0.1:8188/prompt', data=open('/tmp/klein_test_prompt.json','rb').read(), headers={'Content-Type':'application/json'})
d=json.load(urllib.request.urlopen(req, timeout=60))
pid=d['prompt_id']
print('prompt_id', pid)
for i in range(120):
    h=json.load(urllib.request.urlopen(f'http://127.0.0.1:8188/history/{pid}', timeout=30))
    if pid in h:
        print('DONE')
        break
    time.sleep(2)
else:
    print('HIST_TIMEOUT'); raise SystemExit(1)
imgs=sorted(Path('/work/ComfyUI/output').glob('klein_test_*.png'), key=lambda p:p.stat().st_mtime, reverse=True)
print('imgs', [p.name for p in imgs[:3]])
from PIL import Image
import numpy as np
im=Image.open(imgs[0]).convert('RGB')
a=np.asarray(im).astype('float32')
flat=a.reshape(-1,3)
corr=float(np.corrcoef(flat[:,0], flat[:,1])[0,1])
print('std', float(a.std()), 'mean', float(a.mean()), 'rg_corr', corr)
print('LIKELY_NOISE' if abs(corr)<0.2 and 60<a.std()<90 else 'LIKELY_IMAGE')
# copy to fixed path for inspection
out=Path('/work/ComfyUI/output/klein_fix_latest.png')
out.write_bytes(imgs[0].read_bytes())
print('saved', out)
PY
""",
        timeout=400,
    )
    print(out[-3500:], flush=True)
    c.close()


if __name__ == "__main__":
    main()
