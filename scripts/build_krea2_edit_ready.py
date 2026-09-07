#!/usr/bin/env python3
"""Build krea2_edit_READY.json from official example with our model paths."""
import json
import shutil
from pathlib import Path

src = Path("/work/ComfyUI/custom_nodes/comfyui-krea2edit/workflows/krea2_identity_edit.json")
out_dirs = [
    Path("/work/peachbitch/workflows"),
    Path("/work/ComfyUI/user/default/workflows"),
]
d = json.loads(src.read_text(encoding="utf-8"))

# Patch known loaders to match Metalnode layout / abliterated CLIP.
for n in d.get("nodes", []):
    t = n.get("type")
    w = n.get("widgets_values")
    if not isinstance(w, list):
        continue
    if t == "UNETLoader":
        n["widgets_values"] = ["krea2/krea2_turbo_fp8_scaled.safetensors", "default"]
    elif t == "CLIPLoader":
        n["widgets_values"] = [
            "Huihui-Qwen3-VL-4B-Instruct-abliterated.safetensors",
            "krea2",
            "default",
        ]
    elif t == "VAELoader":
        n["widgets_values"] = ["qwen_image_vae.safetensors"]
    elif t == "LoraLoaderModelOnly":
        # keep strength
        strength = w[1] if len(w) > 1 else 1
        n["widgets_values"] = ["krea2/krea2_identity_edit_v1_2.safetensors", strength]
    elif t == "LoadImage" and n.get("id") == 72:
        n["widgets_values"] = ["krea2_edit_smoke_src.png", "image"]
    elif t == "Krea2EditGroundedEncode" and n.get("id") == 84:
        n["widgets_values"] = [
            "change her hair to bright red, keep the same face, body, pose and lighting",
            768,
            "",
        ]
    elif t == "SaveImage":
        n["widgets_values"] = ["krea2/edit"]

for od in out_dirs:
    od.mkdir(parents=True, exist_ok=True)
    path = od / "krea2_edit_READY.json"
    path.write_text(json.dumps(d, ensure_ascii=False), encoding="utf-8")
    print("wrote", path, path.stat().st_size)

# also copy smoke output for convenience
smoke = Path("/work/ComfyUI/output/krea2/edit_smoke_00001_.png")
print("smoke exists", smoke.exists(), smoke.stat().st_size if smoke.exists() else 0)
