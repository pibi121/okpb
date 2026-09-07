#!/usr/bin/env python3
"""Smoke: Krea2 Turbo instruction edit via Identity Edit LoRA + Krea2Edit nodes."""
from __future__ import annotations

import argparse
import json
import shutil
import time
import urllib.request
from pathlib import Path

DEFAULT_SRC = "/work/ComfyUI/output/krea2/olh_nsfw_00010_.png"
INPUT_NAME = "krea2_edit_smoke_src.png"
EDIT_PROMPT = "change her hair to bright red, keep the same face, body, pose and lighting"


def api(path: str, data: dict | None = None, timeout: int = 120):
    url = f"http://127.0.0.1:8188{path}"
    if data is None:
        with urllib.request.urlopen(url, timeout=timeout) as r:
            return json.loads(r.read().decode())
    body = json.dumps(data).encode()
    req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())


def ensure_input(src: str) -> str:
    src_p = Path(src)
    if not src_p.exists():
        raise SystemExit(f"source missing: {src}")
    dst = Path("/work/ComfyUI/input") / INPUT_NAME
    shutil.copy2(src_p, dst)
    print(f"source -> input/{INPUT_NAME} ({src_p.stat().st_size} bytes)")
    return INPUT_NAME


def build_graph(image_name: str, prompt: str, width: int, height: int, seed: int) -> dict:
    # Minimal wiring from comfyui-krea2edit README (Turbo, CFG1, 8 steps).
    return {
        "1": {
            "class_type": "UNETLoader",
            "inputs": {"unet_name": "krea2/krea2_turbo_fp8_scaled.safetensors", "weight_dtype": "default"},
        },
        "2": {
            "class_type": "CLIPLoader",
            "inputs": {
                "clip_name": "Huihui-Qwen3-VL-4B-Instruct-abliterated.safetensors",
                "type": "krea2",
                "device": "default",
            },
        },
        # Official identity-edit example uses qwen_image_vae (not wan_2.1).
        "3": {"class_type": "VAELoader", "inputs": {"vae_name": "qwen_image_vae.safetensors"}},
        "4": {"class_type": "LoadImage", "inputs": {"image": image_name}},
        "5": {
            "class_type": "LoraLoaderModelOnly",
            "inputs": {
                "model": ["1", 0],
                "lora_name": "krea2/krea2_identity_edit_v1_2.safetensors",
                "strength_model": 1.0,
            },
        },
        "6": {"class_type": "VAEEncode", "inputs": {"pixels": ["4", 0], "vae": ["3", 0]}},
        "7": {
            "class_type": "EmptySD3LatentImage",
            "inputs": {"width": width, "height": height, "batch_size": 1},
        },
        "8": {
            "class_type": "Krea2EditModelPatch",
            "inputs": {
                "model": ["5", 0],
                "source_latent": ["6", 0],
                "ref_boost": 4.0,
                "ref_boost_a": 1.0,
                "fit_mode": "fit",
                "vae": ["3", 0],
                "source_image": ["4", 0],
                "target_latent": ["7", 0],
            },
        },
        "9": {
            "class_type": "Krea2EditGroundedEncode",
            "inputs": {
                "clip": ["2", 0],
                "prompt": prompt,
                "image": ["4", 0],
                "grounding_px": 768,
                "system_prompt": "",
            },
        },
        "10": {
            "class_type": "Krea2EditGroundedEncode",
            "inputs": {
                "clip": ["2", 0],
                "prompt": "",
                "image": ["4", 0],
                "grounding_px": 768,
                "system_prompt": "",
            },
        },
        "11": {
            "class_type": "KSampler",
            "inputs": {
                "model": ["8", 0],
                "positive": ["9", 0],
                "negative": ["10", 0],
                "latent_image": ["7", 0],
                "seed": seed,
                "steps": 10,
                "cfg": 1.0,
                "sampler_name": "euler",
                "scheduler": "simple",
                "denoise": 1.0,
            },
        },
        "12": {"class_type": "VAEDecode", "inputs": {"samples": ["11", 0], "vae": ["3", 0]}},
        "13": {
            "class_type": "SaveImage",
            "inputs": {"images": ["12", 0], "filename_prefix": "krea2/edit_smoke"},
        },
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default=DEFAULT_SRC)
    ap.add_argument("--prompt", default=EDIT_PROMPT)
    ap.add_argument("--width", type=int, default=888)
    ap.add_argument("--height", type=int, default=1176)
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args()

    # verify LoRA visible to Comfy
    info = api("/object_info/LoraLoaderModelOnly")
    names = info["LoraLoaderModelOnly"]["input"]["required"]["lora_name"][0]
    if "krea2/krea2_identity_edit_v1_2.safetensors" not in names:
        # force refresh by checking file exists; Comfy may need restart
        lora = Path("/work/ComfyUI/models/loras/krea2/krea2_identity_edit_v1_2.safetensors")
        print("LoRA on disk:", lora.exists(), lora.stat().st_size if lora.exists() else 0)
        print("Comfy does not list identity LoRA yet — refresh/restart may be required")
        print("sample names:", [n for n in names if "krea" in n.lower()][:20])

    image_name = ensure_input(args.src)
    graph = build_graph(image_name, args.prompt, args.width, args.height, args.seed)
    resp = api("/prompt", {"prompt": graph, "client_id": "krea2-edit-smoke"})
    errs = resp.get("node_errors") or {}
    if resp.get("error") or errs:
        print(json.dumps(resp, indent=2)[:3000])
        raise SystemExit(1)
    pid = resp["prompt_id"]
    print("queued", pid, "prompt:", args.prompt)
    t0 = time.time()
    while True:
        hist = api(f"/history/{pid}", timeout=60)
        if pid in hist:
            st = hist[pid].get("status", {})
            if st.get("completed") or st.get("status_str") in ("success", "error"):
                print(json.dumps(hist[pid].get("outputs", {}), indent=2)[:2000])
                print("status:", st.get("status_str"))
                msgs = st.get("messages", [])
                for m in msgs[-5:]:
                    print("msg:", m)
                print(f"elapsed_sec={time.time() - t0:.1f}")
                raise SystemExit(0 if st.get("status_str") == "success" else 1)
        time.sleep(3)
        print(f"waiting... t={time.time() - t0:.0f}s")


if __name__ == "__main__":
    main()
