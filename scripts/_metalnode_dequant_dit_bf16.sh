#!/bin/bash
# Dequantize Comfy-style scaled FP8 DiT -> BF16 for musubi training
set -uo pipefail
export PATH=/usr/bin:/bin:/usr/local/bin
LOG=/work/loras_out/olh_person_klein_train.log
SRC=/work/train/models/flux-2-klein-base-9b-fp8.safetensors
DST=/work/train/models/flux-2-klein-base-9b-bf16.safetensors
log(){ echo "[$(date +%H:%M:%S)] $*" | tee -a "$LOG"; }

if [ -f "$DST" ] && [ "$(stat -c%s "$DST")" -gt 15000000000 ]; then
  log "BF16_ALREADY $(stat -c%s "$DST")"
  exit 0
fi

log "DEQUANT_START $SRC -> $DST"
/work/ai/venv/bin/python - <<'PY'
import torch
from pathlib import Path
from safetensors import safe_open
from safetensors.torch import save_file
import gc

src = Path('/work/train/models/flux-2-klein-base-9b-fp8.safetensors')
dst = Path('/work/train/models/flux-2-klein-base-9b-bf16.safetensors')
tmp = Path('/work/train/models/flux-2-klein-base-9b-bf16.safetensors.partial')

out = {}
n_deq = 0
n_copy = 0
with safe_open(str(src), framework='pt', device='cpu') as f:
    keys = list(f.keys())
    scale_keys = {k for k in keys if k.endswith('.weight_scale') or k.endswith('.input_scale') or k.endswith('.scale_weight')}
    print('total_keys', len(keys), 'scale_like', len(scale_keys), flush=True)
    for k in keys:
        if k.endswith('.weight_scale') or k.endswith('.input_scale') or k.endswith('.scale_weight'):
            continue  # drop scale buffers for bf16 checkpoint
        t = f.get_tensor(k)
        sk = k + '_scale' if False else None
        # Comfy: weight + weight_scale (+ input_scale)
        wscale = k + '.weight_scale' if not k.endswith('.weight') else k[:-len('.weight')] + '.weight_scale'
        # Fix: for key ending with .weight, companion is .weight_scale
        if k.endswith('.weight'):
            wscale = k[:-len('weight')] + 'weight_scale'
            if wscale in keys:
                scale = f.get_tensor(wscale)
                # dequant fp8 -> bf16
                w = t.to(torch.float32)
                # broadcast scale
                while scale.ndim < w.ndim:
                    scale = scale.unsqueeze(-1)
                # sometimes scale is per-row [out,1] or scalar
                try:
                    w = w * scale.to(torch.float32)
                except Exception as e:
                    # try reshape
                    scale2 = scale.reshape(-1)
                    if scale2.numel() == w.shape[0]:
                        w = w * scale2.to(torch.float32).view(-1, *([1]*(w.ndim-1)))
                    else:
                        raise RuntimeError(f'broadcast fail {k} w={tuple(w.shape)} s={tuple(scale.shape)}: {e}')
                out[k] = w.to(torch.bfloat16).contiguous()
                n_deq += 1
                if n_deq <= 3 or n_deq % 50 == 0:
                    print(f'deq {n_deq} {k} {tuple(out[k].shape)}', flush=True)
                continue
        # plain tensor (norms, biases, etc.)
        if t.dtype == torch.float8_e4m3fn:
            out[k] = t.to(torch.bfloat16).contiguous()
            n_deq += 1
        else:
            # keep bf16/fp16/fp32 as bf16 for consistency on floats
            if t.is_floating_point():
                out[k] = t.to(torch.bfloat16).contiguous()
            else:
                out[k] = t.contiguous()
            n_copy += 1

print('n_deq', n_deq, 'n_copy', n_copy, 'out_keys', len(out), flush=True)
# rough size check
bytes_est = sum(v.numel()*v.element_size() for v in out.values())
print('bytes_est', bytes_est, flush=True)
save_file(out, str(tmp))
tmp.replace(dst)
print('SAVED', dst, dst.stat().st_size, flush=True)
del out
gc.collect()
PY
rc=$?
if [ "$rc" -ne 0 ] || [ ! -f "$DST" ]; then
  log "DEQUANT_FAIL rc=$rc"
  exit 1
fi
log "DEQUANT_OK $(ls -lh "$DST")"
exit 0
