#!/bin/bash
export PATH=/usr/bin:/bin
set -e
PY=/work/ai/venv/bin/python
if ! curl -s -m 3 http://127.0.0.1:8188/system_stats >/dev/null; then
  echo STARTING_COMFY
  cd /work/ComfyUI
  nohup "$PY" main.py --listen --port 8188 --enable-manager >> /work/ComfyUI/user/comfyui_8188.log 2>&1 &
  for i in $(seq 1 60); do
    sleep 2
    curl -s -m 2 http://127.0.0.1:8188/system_stats >/dev/null && echo COMFY_UP && break
  done
else
  echo COMFY_ALREADY
fi
ls -lh /work/ComfyUI/models/diffusion_models/flux-2-klein-9b-fp8.safetensors
"$PY" <<'PY'
import json, time, urllib.request
from pathlib import Path
import numpy as np
from PIL import Image
req=urllib.request.Request('http://127.0.0.1:8188/prompt', data=open('/tmp/klein_test_prompt.json','rb').read(), headers={'Content-Type':'application/json'})
d=json.load(urllib.request.urlopen(req, timeout=60))
pid=d['prompt_id']; print('prompt_id', pid, flush=True)
for i in range(300):
    h=json.load(urllib.request.urlopen(f'http://127.0.0.1:8188/history/{pid}', timeout=30))
    if pid in h:
        print('DONE', flush=True)
        print('status', h[pid].get('status'), flush=True)
        break
    if i % 15 == 0:
        print('wait', i*2, 'sec', flush=True)
    time.sleep(2)
else:
    print('HIST_TIMEOUT'); raise SystemExit(1)
imgs=sorted(Path('/work/ComfyUI/output').glob('klein_test_*.png'), key=lambda p:p.stat().st_mtime, reverse=True)
print('imgs',[p.name for p in imgs[:5]], flush=True)
if not imgs:
    print('NO_IMGS'); raise SystemExit(2)
a=np.asarray(Image.open(imgs[0]).convert('RGB')).astype('float32')
flat=a.reshape(-1,3)
corr=float(np.corrcoef(flat[:,0], flat[:,1])[0,1])
print('std', float(a.std()), 'mean', float(a.mean()), 'rg_corr', corr, flush=True)
print('LIKELY_NOISE' if abs(corr)<0.2 and 60<a.std()<90 else 'LIKELY_IMAGE', flush=True)
Path('/work/ComfyUI/output/klein_fix_latest.png').write_bytes(imgs[0].read_bytes())
print('saved klein_fix_latest.png', flush=True)
PY
