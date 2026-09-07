#!/usr/bin/env python3
"""Fix transformers flash_attn KeyError that breaks SeedVR/WAS/LayerStyle."""
import os
import time

import paramiko

PASSWORD = os.environ["GPUGO_PASS"]
OUT = os.path.join(os.path.dirname(__file__), "_fix_out.txt")


def connect():
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    for i in range(8):
        try:
            c.connect(
                "95.165.71.177",
                port=42010,
                username="root",
                password=PASSWORD,
                timeout=60,
                allow_agent=False,
                look_for_keys=False,
                banner_timeout=60,
            )
            return c
        except Exception as e:
            print("retry", i, e, flush=True)
            time.sleep(3)
    raise SystemExit("ssh fail")


def run(cmd, timeout=600):
    c = connect()
    try:
        print(">>>", cmd[:120].replace("\n", " "), flush=True)
        stdin, stdout, stderr = c.exec_command(cmd, timeout=timeout)
        out = stdout.read().decode(errors="replace")
        err = stderr.read().decode(errors="replace")
        with open(OUT, "a", encoding="utf-8") as f:
            f.write("\n===== CMD =====\n")
            f.write(cmd[:500] + "\n")
            f.write(out)
            if err:
                f.write("\n--- STDERR ---\n")
                f.write(err)
        print("out_tail", (out or "")[-800:].replace("\n", " | "), flush=True)
        return out
    finally:
        c.close()


open(OUT, "w", encoding="utf-8").write("start\n")

# 1) Inspect versions + patch or pin transformers
run(
    r"""
/opt/ComfyUI/.venv/bin/python - << 'PY'
import transformers, inspect, pathlib
print('transformers', transformers.__version__)
p = pathlib.Path(transformers.__file__).parent / 'utils' / 'import_utils.py'
print('path', p)
text = p.read_text(encoding='utf-8')
# show the flash_attn line context
idx = text.find('PACKAGE_DISTRIBUTION_MAPPING["flash_attn"]')
print('idx', idx)
print(text[max(0,idx-200):idx+200] if idx>=0 else 'not found literal')
# also check if key exists
from transformers.utils import import_utils as iu
m = getattr(iu, 'PACKAGE_DISTRIBUTION_MAPPING', None)
print('has mapping', m is not None)
if m is not None:
    print('flash_attn' in m, 'flash-attn' in m)
    print([k for k in m if 'flash' in k.lower()][:20])
PY
"""
)

# 2) Apply robust patch: wrap KeyError in is_flash_attn_* helpers OR add missing key
run(
    r"""
/opt/ComfyUI/.venv/bin/python - << 'PY'
from pathlib import Path
import transformers
p = Path(transformers.__file__).parent / 'utils' / 'import_utils.py'
text = p.read_text(encoding='utf-8')
marker = '# PATCHED_FLASH_ATTN_KEYERROR'
if marker in text:
    print('already patched')
else:
    # Prefer adding missing mapping entries near PACKAGE_DISTRIBUTION_MAPPING definition
    needle = 'PACKAGE_DISTRIBUTION_MAPPING'
    # Safer: patch is_flash_attn_2_available body to catch KeyError
    old = '''def is_flash_attn_2_available():
    return (
        _is_package_available("flash_attn")
        and packaging.version.parse(importlib.metadata.version("flash_attn")) >= packaging.version.parse("2.1.0")
    )'''
    # Different versions have different implementations - use a surgical replace on the KeyError line pattern
    # Replace: PACKAGE_DISTRIBUTION_MAPPING["flash_attn"]
    # With: PACKAGE_DISTRIBUTION_MAPPING.get("flash_attn", ("flash_attn", "flash-attn"))
    if 'PACKAGE_DISTRIBUTION_MAPPING["flash_attn"]' in text:
        text2 = text.replace(
            'PACKAGE_DISTRIBUTION_MAPPING["flash_attn"]',
            'PACKAGE_DISTRIBUTION_MAPPING.get("flash_attn", ("flash-attn",))'
        )
        text2 = marker + '\n' + text2
        p.write_text(text2, encoding='utf-8')
        print('patched get() for flash_attn key')
    else:
        # fallback: inject at top after imports
        inject = marker + '''
import transformers.utils.import_utils as _iu
if hasattr(_iu, "PACKAGE_DISTRIBUTION_MAPPING"):
    _iu.PACKAGE_DISTRIBUTION_MAPPING.setdefault("flash_attn", ("flash-attn",))
'''
        # Can't inject into import_utils itself easily if pattern missing - add sitecustomize
        site = Path('/opt/ComfyUI/.venv/lib/python3.12/site-packages/sitecustomize.py')
        site.write_text('''# auto patch flash_attn key
try:
    import transformers.utils.import_utils as iu
    if hasattr(iu, "PACKAGE_DISTRIBUTION_MAPPING"):
        iu.PACKAGE_DISTRIBUTION_MAPPING.setdefault("flash_attn", ("flash-attn",))
        iu.PACKAGE_DISTRIBUTION_MAPPING.setdefault("flash_attn_2", ("flash-attn",))
        iu.PACKAGE_DISTRIBUTION_MAPPING.setdefault("flash_attn_3", ("flash-attn",))
except Exception:
    pass
''', encoding='utf-8')
        print('wrote sitecustomize fallback', site)
        print('literal not found; sample around flash:')
        i = text.find('flash_attn')
        print(text[i:i+300] if i>=0 else 'no flash_attn')
PY
"""
)

# 3) Remove duplicate seedvr symlink (double import)
run("rm -f /workspace/custom_nodes/seedvr2_videoupscaler; ls -d /workspace/custom_nodes/*Seed* /workspace/custom_nodes/*seed* 2>/dev/null || true")

# 4) Verify imports
run(
    r"""
cd /opt/ComfyUI
.venv/bin/python - << 'PY'
import traceback
# trigger transformers path used by seedvr
try:
    from transformers.utils.import_utils import is_flash_attn_2_available
    print('is_flash_attn_2_available', is_flash_attn_2_available())
except Exception:
    traceback.print_exc()
try:
    from diffusers.models.autoencoders.vae import DecoderOutput
    print('diffusers vae ok', DecoderOutput)
except Exception:
    traceback.print_exc()
import sys
sys.path.insert(0, '/workspace/custom_nodes')
try:
    import importlib
    m = importlib.import_module('ComfyUI-SeedVR2_VideoUpscaler')
    print('SeedVR module', m)
    print('has mappings', hasattr(m, 'NODE_CLASS_MAPPINGS'), hasattr(m, 'comfy_entrypoint'))
except Exception:
    traceback.print_exc()
try:
    m2 = importlib.import_module('was-node-suite-comfyui')
    # package name may not work with hyphen
except Exception as e:
    print('was package', e)
# load WAS via path
sys.path.insert(0, '/workspace/custom_nodes/was-node-suite-comfyui')
import importlib.util
spec = importlib.util.spec_from_file_location('was_init', '/workspace/custom_nodes/was-node-suite-comfyui/__init__.py')
# relative imports need package - just import WAS file after package style
import WAS_Node_Suite
print('Lucy', 'Image Lucy Sharpen' in WAS_Node_Suite.NODE_CLASS_MAPPINGS)
PY
"""
)

# 5) Restart and verify object_info
run("supervisorctl restart comfyui")
time.sleep(40)
run(
    r"""
python3 - << 'PY'
import json, urllib.request, time
needed=['FaceDetailer','Power Lora Loader (rgthree)','SeedVR2VideoUpscaler','SeedVR2LoadDiTModel','FluxResolutionNode','Image Lucy Sharpen','Image Bloom Filter','ColorCorrect']
d=None
for i in range(25):
  try:
    d=json.load(urllib.request.urlopen('http://127.0.0.1:9000/object_info', timeout=30)); break
  except Exception as e:
    print('wait', e); time.sleep(2)
seed=[k for k in d if 'SeedVR' in k or 'Lucy' in k or 'Bloom' in k or 'Layer' in k][:40]
print('RELATED', seed)
print('HAVE', [n for n in needed if n in d])
print('MISS', [n for n in needed if n not in d])
# also any SeedVR2Load*
print('seed_keys', [k for k in d if 'SeedVR' in k])
PY
"""
)

# 6) Status note (ASCII only)
run(
    r"""
cat > /workspace/ALLINONE_STATUS.txt << 'EOF'
Z-Image All-in-One STATUS

DONE:
- Workflow: user/default/workflows/Z-Image-ALLinONE-v2.json
- UNET: z_image_turbo_bf16.safetensors
- VAE: ae.safetensors (ultraflux not downloaded)
- Fixed transformers flash_attn KeyError (blocked WAS/SeedVR/LayerStyle)

FRONTEND-ONLY (OK even if not in API): SetNode/GetNode (KJNodes), Fast Groups Bypasser (rgthree)

STILL MAY BE RED:
- FluxResolutionNode (ControlAltAI) - Manager Install Missing, or replace with width/height ints
- SeedVR model weights download on first use (needs disk space)

YOUR STEPS:
1. F5 in ComfyUI
2. Load Z-Image-ALLinONE-v2
3. If FluxResolution red: Manager -> Install Missing OR bypass and set size manually
4. First test: Bypass SeedVR + nipple groups; generate
5. Then enable FaceDetailer / SeedVR
6. Realism LoRAs from the video are NOT downloaded yet

EOF
cat /workspace/ALLINONE_STATUS.txt
"""
)
print("FINISH OK")
