#!/usr/bin/env python3
import os, time, paramiko

PASSWORD = os.environ["GPUGO_PASS"]

def connect():
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect("95.165.71.177", port=42010, username="root", password=PASSWORD,
              timeout=45, allow_agent=False, look_for_keys=False, banner_timeout=30)
    return c

def run(cmd, timeout=600):
    c = connect()
    try:
        print(">>>", cmd[:120], flush=True)
        stdin, stdout, stderr = c.exec_command(cmd, timeout=timeout)
        out = stdout.read().decode(errors="replace")
        err = stderr.read().decode(errors="replace")
        code = stdout.channel.recv_exit_status()
        if out: print(out[-4000:], flush=True)
        if err: print("ERR:", err[-2000:], flush=True)
        print("[exit", code, "]", flush=True)
        return code, out
    finally:
        c.close()

# 1) status
run("ls /workspace/custom_nodes; ls /workspace/user/default/workflows/ | grep -i allin || true; ps aux | grep -E 'git clone|pip install' | grep -v grep | head")

# 2) kill hung credential prompts
run("pkill -9 -f 'git clone' || true; sleep 1; echo killed")

# 3) clone packs (no prompt)
clones = r'''
export GIT_TERMINAL_PROMPT=0
cd /workspace/custom_nodes
rm -rf ControlAltAI-Nodes ComfyUI-Fluxor controlaltai-nodes controlaltai-nodes2 2>/dev/null || true
clone() { [ -d "$1" ] && echo EXISTS "$1" && return 0; echo CLONE "$1"; git -c credential.helper= clone --depth 1 "$2" "$1" && echo OK "$1" || echo FAIL "$1"; }
clone rgthree-comfy https://github.com/rgthree/rgthree-comfy.git
clone ComfyUI-SeedVR2_VideoUpscaler https://github.com/numz/ComfyUI-SeedVR2_VideoUpscaler.git
clone was-node-suite-comfyui https://github.com/WASasquatch/was-node-suite-comfyui.git
clone ComfyUI-post-processing-nodes https://github.com/EllangoK/ComfyUI-post-processing-nodes.git
clone cg-use-everywhere https://github.com/chrisgoringe/cg-use-everywhere.git
clone ComfyUI_LayerStyle https://github.com/chflame163/ComfyUI_LayerStyle.git
clone ComfyUI-Easy-Use https://github.com/yolain/ComfyUI-Easy-Use.git
clone ComfyUI-Custom-Scripts https://github.com/pythongosssss/ComfyUI-Custom-Scripts.git
echo ====
ls -1
'''
run(clones, timeout=900)

# 4) light pip for seedvr only if requirements small
run("""
export GIT_TERMINAL_PROMPT=0
PY=/opt/ComfyUI/.venv/bin/pip
[ -x "$PY" ] || PY=pip3
if [ -f /workspace/custom_nodes/ComfyUI-SeedVR2_VideoUpscaler/requirements.txt ]; then
  $PY install -q -r /workspace/custom_nodes/ComfyUI-SeedVR2_VideoUpscaler/requirements.txt || true
fi
if [ -f /workspace/custom_nodes/was-node-suite-comfyui/requirements.txt ]; then
  $PY install -q -r /workspace/custom_nodes/was-node-suite-comfyui/requirements.txt || true
fi
echo PIP_DONE
""", timeout=900)

# 5) restart comfy
run("supervisorctl restart comfyui; sleep 25; supervisorctl status comfyui")

# 6) check missing nodes
run("""python3 - <<'PY'
import json, urllib.request
needed = ["FaceDetailer","Power Lora Loader (rgthree)","Lora Loader Stack (rgthree)","SeedVR2VideoUpscaler","SeedVR2LoadDiTModel","FluxResolutionNode","Image Lucy Sharpen","ColorCorrect","ChromaticAberration","Image Bloom Filter","Image Comparer (rgthree)","SetNode","GetNode","Fast Groups Bypasser (rgthree)"]
for i in range(10):
  try:
    d=json.load(urllib.request.urlopen('http://127.0.0.1:9000/object_info', timeout=30))
    break
  except Exception as e:
    print('wait', e); import time; time.sleep(3)
else:
  raise SystemExit('comfy not up')
miss=[n for n in needed if n not in d]
print('MISSING', miss)
print('OK_COUNT', len(needed)-len(miss), '/', len(needed))
PY""")

# 7) ready note
run("""cat > /workspace/ALLINONE_STATUS.txt << 'EOF'
Z-Image All-in-One v2 uploaded:
  /workspace/user/default/workflows/Z-Image-ALLinONE-v2.json

UNET patched to: z_image_turbo_bf16.safetensors
CLIP: qwen_3_4b (already on disk)
VAE in JSON: ultrafluxVAEImproved_v10 (may need download) OR use ae.safetensors

In ComfyUI:
1) F5
2) Load workflow Z-Image-ALLinONE-v2
3) Manager -> Install Missing Custom Nodes (if any red)
4) Bypass heavy groups first (SeedVR/Detailer) if OOM
5) Queue

Character/realism LoRAs from the video are NOT downloaded yet - leave empty or install from Civitai.
EOF
cat /workspace/ALLINONE_STATUS.txt
""")
print("ALL DONE")
