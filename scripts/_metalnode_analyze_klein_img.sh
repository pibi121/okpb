#!/bin/bash
export PATH=/usr/bin:/bin
/work/ai/venv/bin/python <<'PY'
from pathlib import Path
import numpy as np
from PIL import Image
p=Path('/work/ComfyUI/output/klein_test_00001_.png')
a=np.asarray(Image.open(p).convert('RGB')).astype('float32')
flat=a.reshape(-1,3)
corr_rg=float(np.corrcoef(flat[:,0], flat[:,1])[0,1])
corr_rb=float(np.corrcoef(flat[:,0], flat[:,2])[0,1])
corr_gb=float(np.corrcoef(flat[:,1], flat[:,2])[0,1])
print('file', p, 'size', p.stat().st_size)
print('shape', a.shape)
print('std', float(a.std()), 'mean', float(a.mean()))
print('rg', corr_rg, 'rb', corr_rb, 'gb', corr_gb)
# noise heuristic
print('LIKELY_NOISE' if abs(corr_rg)<0.2 and 60<a.std()<90 else 'LIKELY_IMAGE')
Path('/work/ComfyUI/output/klein_fix_latest.png').write_bytes(p.read_bytes())
PY
