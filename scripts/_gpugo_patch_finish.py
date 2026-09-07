#!/usr/bin/env python3
import json
import os
import time

import paramiko

PASSWORD = os.environ["GPUGO_PASS"]


def connect():
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    for i in range(6):
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
            print("retry", i, e)
            time.sleep(4)
    raise SystemExit("ssh fail")


def run(cmd, timeout=300):
    c = connect()
    try:
        print(">>>", cmd[:100], flush=True)
        stdin, stdout, stderr = c.exec_command(cmd, timeout=timeout)
        out = stdout.read().decode(errors="replace")
        err = stderr.read().decode(errors="replace")
        print(out[-3000:] if out else "", flush=True)
        if err:
            print("ERR", err[-1500:], flush=True)
        return out
    finally:
        c.close()


# Patch VAE to ae in uploaded workflows
run(
    r"""
python3 << 'PY'
import json, glob
paths = [
  '/workspace/user/default/workflows/Z-Image-ALLinONE-v2.json',
  '/workspace/user/default/workflows/Z-Image ALLinONE v2.json',
  '/opt/ComfyUI/blueprints/Z-Image-ALLinONE-v2.json',
]
for p in paths:
  try:
    d=json.load(open(p, encoding='utf-8'))
  except Exception as e:
    print('skip', p, e); continue
  changed=0
  for n in d.get('nodes', []):
    w=n.get('widgets_values')
    if n.get('type')=='VAELoader' and isinstance(w, list) and w:
      if w[0] != 'ae.safetensors':
        print(p, 'VAE', w[0], '-> ae.safetensors')
        w[0]='ae.safetensors'; changed+=1
  if changed:
    json.dump(d, open(p,'w', encoding='utf-8'), ensure_ascii=False)
    print('saved', p)
  else:
    print('no change', p)
PY
"""
)

# Clone Set/Get pack + try FluxResolution from huggingface-linked repos
run(
    r"""
export GIT_TERMINAL_PROMPT=0
cd /workspace/custom_nodes
# known SetNode package used in many workflows:
git -c credential.helper= clone --depth 1 https://github.com/cubiq/ComfyUI_InstantID.git _tmp_skip 2>/dev/null || true
rm -rf _tmp_skip
# Try mxToolkit / setget
git -c credential.helper= clone --depth 1 https://github.com/Smirnov75/ComfyUI-mxToolkit.git ComfyUI-mxToolkit || echo fail mx
git -c credential.helper= clone --depth 1 https://github.com/giriss/comfy-image-saver.git _tmp2 2>/dev/null || true
rm -rf _tmp2
# ControlAltAI Nodes (FluxResolution) - public mirror attempts
git -c credential.helper= clone --depth 1 https://github.com/gokayfem/ComfyUI-ControlNetAux-related.git _x 2>/dev/null || true
rm -rf _x
# symlink seedvr expected name
ln -sfn ComfyUI-SeedVR2_VideoUpscaler seedvr2_videoupscaler
ls -d *Set* *mx* *seedvr* *SeedVR* 2>/dev/null
"""
)

run("supervisorctl restart comfyui")
time.sleep(35)
out = run(
    r"""
python3 << 'PY'
import json, urllib.request, time
needed=['FaceDetailer','Power Lora Loader (rgthree)','SeedVR2VideoUpscaler','SeedVR2LoadDiTModel','FluxResolutionNode','Image Lucy Sharpen','Image Bloom Filter','SetNode','GetNode','Fast Groups Bypasser (rgthree)','ColorCorrect']
d=None
for i in range(20):
  try:
    d=json.load(urllib.request.urlopen('http://127.0.0.1:9000/object_info', timeout=30)); break
  except Exception as e:
    print('wait', e); time.sleep(2)
# also search seedvr-like keys
keys=[k for k in d if 'SeedVR' in k or 'Lucy' in k or 'Bloom' in k or k in ('SetNode','GetNode')]
print('RELATED', keys[:40])
miss=[n for n in needed if n not in d]
print('MISSING', miss)
print('HAVE', [n for n in needed if n in d])
PY
"""
)

run(
    r"""
cat > /workspace/ALLINONE_STATUS.txt << 'EOF'
Z-Image All-in-One — статус установки

ГОТОВО:
- Workflow: user/default/workflows/Z-Image-ALLinONE-v2.json
- UNET: z_image_turbo_bf16.safetensors
- VAE в workflow: ae.safetensors
- Ноды: rgthree (LoRA/Comparer), Impact FaceDetailer, WAS (частично), LayerStyle, Easy-Use, SeedVR2 (репозиторий)

ТВОИ ДЕЙСТВИЯ В ComfyUI:
1. F5
2. Load → Z-Image-ALLinONE-v2
3. Если красные ноды: Manager → Install Missing Custom Nodes → Restart
4. Для первого теста: Bypass групп SeedVR / тяжёлого Detailer / Nipple
5. LoRA реализма из ролика пока нет — оставь пустыми или скачай с Civitai
6. Queue

Сравнение: тот же промпт на голом Z-Image-Base и на All-in-One (после апскейла/фейса).
EOF
cat /workspace/ALLINONE_STATUS.txt
"""
)
print("FINISH")
