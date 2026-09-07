#!/usr/bin/env python3
import os
import paramiko

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(
    "95.165.71.177",
    port=42010,
    username="root",
    password=os.environ["GPUGO_PASS"],
    timeout=45,
    allow_agent=False,
    look_for_keys=False,
)
cmd = r"""
set +e
echo '=== supervisor logs ==='
ls /var/log/supervisor/ 2>/dev/null
for f in /var/log/supervisor/*comfy*; do echo FILE $f; tail -n 80 "$f" 2>/dev/null | grep -iE 'seedvr|SeedVR|Error|Traceback|ModuleNotFound|FAILED' | tail -30; done
echo '=== seedvr dir ==='
ls /workspace/custom_nodes/ComfyUI-SeedVR2_VideoUpscaler | head
echo '=== try import seedvr ==='
cd /workspace/custom_nodes/ComfyUI-SeedVR2_VideoUpscaler
/opt/ComfyUI/.venv/bin/python -c 'import src; print("src ok")' 2>&1 | tail -40
echo '=== Lucy Bloom in WAS ==='
grep -n 'Lucy\|Bloom Filter\|NODE_CLASS_MAPPINGS' /workspace/custom_nodes/was-node-suite-comfyui/WAS_Node_Suite.py 2>/dev/null | head -30
echo '=== SetNode search ==='
grep -rln 'SetNode' /workspace/custom_nodes --include='*.py' 2>/dev/null | head
echo '=== Fast Groups ==='
grep -rn 'Fast Groups Bypasser\|fast_groups' /workspace/custom_nodes/rgthree-comfy 2>/dev/null | head
echo '=== write status ==='
cat > /workspace/ALLINONE_STATUS.txt << 'EOF'
Z-Image All-in-One: PARTIAL READY

Uploaded workflow:
  user/default/workflows/Z-Image-ALLinONE-v2.json
  (UNET set to z_image_turbo_bf16.safetensors)

Installed packs: rgthree, SeedVR2 repo, WAS, LayerStyle, Easy-Use, Custom-Scripts, post-processing, use-everywhere

Working nodes now: FaceDetailer, Power Lora, ColorCorrect, ChromaticAberration, Image Comparer

May still be RED (use Manager Install Missing, or Bypass groups):
  - SeedVR2* (check import / models)
  - FluxResolutionNode
  - Image Lucy Sharpen / Image Bloom Filter (WAS naming)
  - SetNode / GetNode
  - Fast Groups Bypasser

What you do:
1. F5 in ComfyUI
2. Load Z-Image-ALLinONE-v2
3. Manager -> Install Missing Custom Nodes for any red
4. If SeedVR/Detailer red: select those groups -> Bypass, generate base first
5. VAE: if ultraflux missing, pick ae.safetensors
6. LoRAs from video not downloaded - leave empty for first test
EOF
cat /workspace/ALLINONE_STATUS.txt
"""
stdin, stdout, stderr = c.exec_command(cmd, timeout=180)
print(stdout.read().decode(errors="replace"))
print(stderr.read().decode(errors="replace"))
c.close()
