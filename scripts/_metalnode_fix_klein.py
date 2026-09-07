#!/usr/bin/env python3
from pathlib import Path
import paramiko
import sys
import time
import json
import urllib.request

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.stdout.reconfigure(line_buffering=True)

KEY = Path(r"C:\Users\Олег\Downloads\metalnode_id_ed25519 (1).txt")
SCR = Path(__file__).with_name("_metalnode_redownload_klein.sh")
EXPECT_SHA = "865ba09f5b4c3cbd3468a4bd3acb9fcb2f8740c54317482f0bcd4ed1d3655cee"
WF = Path(r"C:\Users\Олег\Desktop\Проект Х\peachbitch\workflows\Flux2-Klein-9B-SNOFS-Lenovo.json")


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
    sftp.put(str(SCR), "/tmp/redownload_klein.sh")
    sftp.close()

    # start download in background on server
    out, _ = run(
        c,
        "nohup bash /tmp/redownload_klein.sh > /work/REDOWNLOAD_KLEIN.nohup 2>&1 & echo PID:$!",
        timeout=30,
    )
    print(out, flush=True)

    for i in range(120):
        time.sleep(20)
        out, _ = run(
            c,
            """
export PATH=/usr/bin:/bin
tail -5 /work/REDOWNLOAD_KLEIN.log 2>/dev/null
ls -lh /work/ComfyUI/models/diffusion_models/flux-2-klein-9b-fp8.safetensors* 2>/dev/null
pgrep -c aria2c || echo 0
""",
            timeout=30,
        )
        print(f"=== {i} ===", flush=True)
        print(out[-800:], flush=True)
        if "READY" in out and EXPECT_SHA[:12] in out:
            print("DOWNLOAD_OK", flush=True)
            break
        if "SHA_MISMATCH" in out or "SIZE_MISMATCH" in out:
            print("DOWNLOAD_FAIL", out, flush=True)
            c.close()
            return
    else:
        print("TIMEOUT", flush=True)
        c.close()
        return

    # Build minimal API prompt without LoRAs from workflow
    wf = json.loads(WF.read_text(encoding="utf-8"))
    # Convert workflow UI format is hard; use simpler Comfy API via queue with saved workflow
    # Instead: ask Comfy to run via python on server using comfy's nodes - use /prompt with API format

    # Convert UI workflow to API via Comfy's endpoint if available, or craft minimal graph
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
                "text": "a candid smartphone photo of a red apple on a wooden table, natural light",
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

    # Queue via SSH localhost to avoid tunnel
    payload = json.dumps({"prompt": api_prompt})
    sftp = c.open_sftp()
    with sftp.file("/tmp/klein_test_prompt.json", "w") as f:
        f.write(payload)
    sftp.close()

    out, err = run(
        c,
        """
export PATH=/usr/bin:/bin
# ensure comfy up
if ! curl -s -m 3 http://127.0.0.1:8188/system_stats >/dev/null; then
  echo COMFY_DOWN
  # try start
  cd /work/ComfyUI
  nohup /work/ai/venv/bin/python main.py --listen --port 8188 --enable-manager >> /work/ComfyUI/user/comfyui_8188.log 2>&1 &
  sleep 8
fi
curl -s -m 5 http://127.0.0.1:8188/system_stats | head -c 300; echo
# queue
RESP=$(curl -s -m 30 -X POST http://127.0.0.1:8188/prompt -H 'Content-Type: application/json' --data @/tmp/klein_test_prompt.json)
echo "QUEUE:$RESP"
PID=$(python3 -c "import json,sys; print(json.load(sys.stdin).get('prompt_id',''))" <<<"$RESP")
echo "PID=$PID"
for i in $(seq 1 60); do
  HIST=$(curl -s -m 10 http://127.0.0.1:8188/history/$PID)
  echo "$HIST" | python3 -c "import sys,json; d=json.load(sys.stdin); print('KEYS',list(d.keys()));
import sys
pid=sys.argv[1]
if pid in d:
  print('DONE')
  outs=d[pid].get('outputs',{})
  print(outs)
" "$PID" 2>/dev/null && break
  sleep 2
done
# show latest klein_test image stats
ls -lt /work/ComfyUI/output/klein_test* 2>/dev/null | head -5
python3 - <<'PY'
from pathlib import Path
try:
 from PIL import Image
 import numpy as np
 imgs=sorted(Path('/work/ComfyUI/output').glob('klein_test*.png'), key=lambda p:p.stat().st_mtime, reverse=True)
 if not imgs:
  print('NO_IMAGE'); raise SystemExit
 im=Image.open(imgs[0]).convert('RGB')
 a=np.asarray(im).astype(np.float32)
 std=a.std(); mean=a.mean()
 # noise has high std across channels randomly; real image has structure
 print('file', imgs[0].name, 'std', round(float(std),2), 'mean', round(float(mean),2))
 # simple heuristic: pure noise often mean~127 std~70+; apple photo lower structure variance differently
 print('OK_HEURISTIC' if std < 90 else 'MAYBE_NOISE')
except Exception as e:
 print('IMG_ERR', e)
PY
tail -30 /work/ComfyUI/user/comfyui_8188.log
""",
        timeout=300,
    )
    print(out[-5000:], flush=True)
    if err:
        print("ERR", err[-1000:], flush=True)
    c.close()


if __name__ == "__main__":
    main()
