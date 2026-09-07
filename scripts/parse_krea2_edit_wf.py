#!/usr/bin/env python3
"""Parse official krea2_identity_edit example workflow."""
import json
from pathlib import Path

p = Path("/work/ComfyUI/custom_nodes/comfyui-krea2edit/workflows/krea2_identity_edit.json")
d = json.loads(p.read_text(encoding="utf-8"))
print("nodes", len(d.get("nodes", [])))
for n in d.get("nodes", []):
    t = n.get("type") or ""
    w = n.get("widgets_values")
    keep = any(
        k in t
        for k in (
            "Krea",
            "Lora",
            "UNET",
            "CLIP",
            "VAE",
            "Empty",
            "Sampler",
            "Load",
            "Save",
            "Image",
        )
    )
    if keep:
        print(n["id"], t, (w[:6] if isinstance(w, list) else w))
