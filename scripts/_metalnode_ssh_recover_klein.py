#!/usr/bin/env python3
"""Retry SSH until banner works, then check Klein download / finish."""
from pathlib import Path
import paramiko
import sys
import time
import json
import socket

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.stdout.reconfigure(line_buffering=True)

KEY = Path(r"C:\Users\Олег\Downloads\metalnode_id_ed25519 (1).txt")
EXPECT = "865ba09f5b4c3cbd3468a4bd3acb9fcb2f8740c54317482f0bcd4ed1d3655cee"
HOST = "77.94.203.13"
PORT = 22024


def try_connect(timeout=30):
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    pkey = paramiko.Ed25519Key.from_private_key_file(str(KEY))
    c.connect(
        HOST,
        port=PORT,
        username="root",
        pkey=pkey,
        timeout=timeout,
        allow_agent=False,
        look_for_keys=False,
        banner_timeout=timeout,
    )
    return c


def main():
    c = None
    for i in range(120):  # up to ~2h with 60s sleep
        try:
            print(f"try {i}...", flush=True)
            # quick TCP
            s = socket.create_connection((HOST, PORT), timeout=10)
            s.close()
            c = try_connect(40)
            print("SSH_OK", flush=True)
            break
        except Exception as e:
            print(f"fail: {type(e).__name__}: {e}", flush=True)
            time.sleep(60)
    else:
        print("SSH_GIVE_UP", flush=True)
        return

    def run(cmd, timeout=120):
        _, so, se = c.exec_command(cmd, timeout=timeout)
        return so.read().decode("utf-8", errors="replace")

    print(run("""
export PATH=/usr/bin:/bin
date
ls -lh /work/ComfyUI/models/diffusion_models/flux-2-klein-9b-fp8.safetensors* 2>/dev/null
pgrep -a curl | head -5 || echo no_curl
grep -E 'READY|RESUME3|curl_exit3|SHA|SIZE' /work/REDOWNLOAD_KLEIN_CURL.log | tail -20
tail -c 400 /work/REDOWNLOAD_KLEIN_CURL.log | tr '\\r' '\\n' | tail -5
"""), flush=True)

    # If curl dead and not READY, restart resume3
    status = run("grep READY /work/REDOWNLOAD_KLEIN_CURL.log | tail -1; pgrep -c curl || echo 0; test -f /work/ComfyUI/models/diffusion_models/flux-2-klein-9b-fp8.safetensors && sha256sum /work/ComfyUI/models/diffusion_models/flux-2-klein-9b-fp8.safetensors || echo NODEST")
    print("STATUS", status, flush=True)

    if EXPECT[:16] not in status or "READY" not in run("grep READY /work/REDOWNLOAD_KLEIN_CURL.log | tail -1"):
        dest_ok = EXPECT in status
        if not dest_ok:
            # ensure download running
            curl_n = run("pgrep -c curl || echo 0").strip()
            if curl_n == "0" or curl_n.endswith("\n0"):
                print("RESTART_DOWNLOAD", flush=True)
                sftp = c.open_sftp()
                local = Path(__file__).with_name("_metalnode_curl_klein_resume3.sh")
                sftp.put(str(local), "/tmp/curl_klein_resume3.sh")
                sftp.close()
                print(run("nohup bash /tmp/curl_klein_resume3.sh > /work/REDOWNLOAD_KLEIN_CURL.nohup 2>&1 & echo PID:$!; sleep 5; pgrep -a curl | head -2"), flush=True)

            # poll until ready
            for j in range(240):
                time.sleep(30)
                # reconnect if needed
                try:
                    out = run("""
ls -lh /work/ComfyUI/models/diffusion_models/flux-2-klein-9b-fp8.safetensors* 2>/dev/null
pgrep -c curl || echo 0
grep -E 'READY|curl_exit3|SHA_MISMATCH3|SIZE_MISMATCH3' /work/REDOWNLOAD_KLEIN_CURL.log | tail -5
tail -c 250 /work/REDOWNLOAD_KLEIN_CURL.log | tr '\\r' '\\n' | tail -2
""")
                except Exception as e:
                    print(f"poll_ssh_lost {e}, reconnect", flush=True)
                    try:
                        c.close()
                    except Exception:
                        pass
                    for _ in range(10):
                        try:
                            c = try_connect(40)
                            break
                        except Exception:
                            time.sleep(30)
                    continue
                print(f"=== {j} ===", flush=True)
                print(out[-800:], flush=True)
                if "READY" in out and EXPECT[:16] in out:
                    break
            else:
                print("DOWNLOAD_TIMEOUT", flush=True)
                return

    print("VERIFY_AND_TEST", flush=True)
    api_prompt = {
        "126": {"class_type": "UNETLoader", "inputs": {"unet_name": "flux-2-klein-9b-fp8.safetensors", "weight_dtype": "default"}},
        "136": {"class_type": "CLIPLoader", "inputs": {"clip_name": "qwen_3_8b_fp8mixed.safetensors", "type": "flux2", "device": "default"}},
        "102": {"class_type": "VAELoader", "inputs": {"vae_name": "flux2-vae.safetensors"}},
        "105": {"class_type": "EmptyFlux2LatentImage", "inputs": {"width": 1024, "height": 1024, "batch_size": 1}},
        "107": {"class_type": "CLIPTextEncode", "inputs": {"text": "a candid smartphone photo of a red apple on a wooden table, natural daylight", "clip": ["136", 0]}},
        "100": {"class_type": "FluxGuidance", "inputs": {"conditioning": ["107", 0], "guidance": 4.0}},
        "135": {"class_type": "ConditioningZeroOut", "inputs": {"conditioning": ["107", 0]}},
        "134": {"class_type": "KSampler", "inputs": {"seed": 42, "steps": 4, "cfg": 1.0, "sampler_name": "euler", "scheduler": "simple", "denoise": 1.0, "model": ["126", 0], "positive": ["100", 0], "negative": ["135", 0], "latent_image": ["105", 0]}},
        "104": {"class_type": "VAEDecode", "inputs": {"samples": ["134", 0], "vae": ["102", 0]}},
        "9": {"class_type": "SaveImage", "inputs": {"images": ["104", 0], "filename_prefix": "klein_test"}},
    }
    sftp = c.open_sftp()
    with sftp.file("/tmp/klein_test_prompt.json", "w") as f:
        f.write(json.dumps({"prompt": api_prompt}))
    sftp.close()

    out = run(r"""
export PATH=/usr/bin:/bin
sha256sum /work/ComfyUI/models/diffusion_models/flux-2-klein-9b-fp8.safetensors
if ! curl -s -m 3 http://127.0.0.1:8188/system_stats >/dev/null; then
  cd /work/ComfyUI
  nohup /work/ai/venv/bin/python main.py --listen --port 8188 --enable-manager >> /work/ComfyUI/user/comfyui_8188.log 2>&1 &
  for i in $(seq 1 40); do sleep 2; curl -s -m 2 http://127.0.0.1:8188/system_stats >/dev/null && break; done
fi
python3 - <<'PY'
import json, time, urllib.request
from pathlib import Path
import numpy as np
from PIL import Image
req=urllib.request.Request('http://127.0.0.1:8188/prompt', data=open('/tmp/klein_test_prompt.json','rb').read(), headers={'Content-Type':'application/json'})
d=json.load(urllib.request.urlopen(req, timeout=60))
pid=d['prompt_id']; print('prompt_id', pid)
for i in range(180):
    h=json.load(urllib.request.urlopen(f'http://127.0.0.1:8188/history/{pid}', timeout=30))
    if pid in h:
        print('DONE'); break
    time.sleep(2)
else:
    print('HIST_TIMEOUT'); raise SystemExit(1)
imgs=sorted(Path('/work/ComfyUI/output').glob('klein_test_*.png'), key=lambda p:p.stat().st_mtime, reverse=True)
print('imgs',[p.name for p in imgs[:3]])
a=np.asarray(Image.open(imgs[0]).convert('RGB')).astype('float32')
flat=a.reshape(-1,3)
corr=float(np.corrcoef(flat[:,0], flat[:,1])[0,1])
print('std', float(a.std()), 'mean', float(a.mean()), 'rg_corr', corr)
print('LIKELY_NOISE' if abs(corr)<0.2 and 60<a.std()<90 else 'LIKELY_IMAGE')
Path('/work/ComfyUI/output/klein_fix_latest.png').write_bytes(imgs[0].read_bytes())
PY
""", timeout=700)
    print(out[-5000:], flush=True)
    c.close()


if __name__ == "__main__":
    main()
