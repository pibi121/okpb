#!/bin/bash
export PATH=/usr/bin:/bin:/usr/local/bin
cd /work/ComfyUI/models/diffusion_models
pkill -f aria2c || true
[ -e flux-2-klein-9b.safetensors ] || ln -sf flux-2-klein-9b-fp8.safetensors flux-2-klein-9b.safetensors
rm -f flux-2-klein-9b-fp8.safetensors.part flux-2-klein-9b-fp8.safetensors.part.aria2 flux-2-klein-9b-fp8.safetensors.aria2
ls -lh flux-2-klein-9b* ../text_encoders/qwen_3_8b* ../vae/flux2-vae* ../loras/klein_snofs* ../loras/lenovo_flux*
ls -lh /work/ComfyUI/user/default/workflows/Flux2-Klein-9B-SNOFS-Lenovo.json
python3 - <<'PY'
from pathlib import Path
need={
 Path('/work/ComfyUI/models/diffusion_models/flux-2-klein-9b-fp8.safetensors'):9433061528,
 Path('/work/ComfyUI/models/text_encoders/qwen_3_8b_fp8mixed.safetensors'):7000000000,
 Path('/work/ComfyUI/models/vae/flux2-vae.safetensors'):300000000,
 Path('/work/ComfyUI/models/loras/klein_snofs_v1_4.safetensors'):900000000,
 Path('/work/ComfyUI/models/loras/lenovo_flux_klein9b.safetensors'):100000000,
}
ok=True
for p,m in need.items():
 sz=p.stat().st_size if p.exists() else 0
 print(('OK' if sz>=m else 'MISS'), p.name, sz)
 if sz<m: ok=False
print('ALL_READY' if ok else 'INCOMPLETE')
Path('/work/INSTALL_KLEIN_STATUS.txt').write_text(('READY\n' if ok else 'INCOMPLETE\n'))
PY
cat /work/INSTALL_KLEIN_STATUS.txt
pgrep -af 'python.*main.py|ComfyUI' | head -5
