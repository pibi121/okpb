#!/usr/bin/env python3
"""Queue a minimal Krea2 Turbo T2I smoke test against local ComfyUI."""
import argparse
import json
import time
import urllib.request

DEFAULT_PROMPT = (
    "cinematic portrait of a young woman with long dark hair, "
    "soft natural window light, 85mm lens, shallow depth of field, "
    "photorealistic skin texture, intimate bedroom mood"
)


def build_prompt(unet: str, clip: str, vae: str, text: str, seed: int) -> dict:
    return {
        "1": {
            "class_type": "UNETLoader",
            "inputs": {"unet_name": unet, "weight_dtype": "default"},
        },
        "2": {
            "class_type": "CLIPLoader",
            "inputs": {"clip_name": clip, "type": "krea2", "device": "default"},
        },
        "3": {
            "class_type": "VAELoader",
            "inputs": {"vae_name": vae},
        },
        "4": {
            "class_type": "CLIPTextEncode",
            "inputs": {"clip": ["2", 0], "text": text},
        },
        "5": {
            "class_type": "CLIPTextEncode",
            "inputs": {"clip": ["2", 0], "text": ""},
        },
        "6": {
            "class_type": "EmptyLatentImage",
            "inputs": {"width": 888, "height": 1176, "batch_size": 1},
        },
        "7": {
            "class_type": "KSampler",
            "inputs": {
                "model": ["1", 0],
                "positive": ["4", 0],
                "negative": ["5", 0],
                "latent_image": ["6", 0],
                "seed": seed,
                "steps": 8,
                "cfg": 1.0,
                "sampler_name": "euler",
                "scheduler": "normal",
                "denoise": 1.0,
            },
        },
        "8": {
            "class_type": "VAEDecode",
            "inputs": {"samples": ["7", 0], "vae": ["3", 0]},
        },
        "9": {
            "class_type": "SaveImage",
            "inputs": {"images": ["8", 0], "filename_prefix": "krea2/t2i_smoke"},
        },
    }


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--host", default="http://127.0.0.1:8188")
    p.add_argument("--unet", default="krea2/krea2_turbo_fp8_scaled.safetensors")
    p.add_argument("--clip", default="Huihui-Qwen3-VL-4B-Instruct-abliterated.safetensors")
    p.add_argument("--vae", default="wan_2.1_vae.safetensors")
    p.add_argument("--prompt", default=DEFAULT_PROMPT)
    p.add_argument("--seed", type=int, default=42)
    args = p.parse_args()

    graph = build_prompt(args.unet, args.clip, args.vae, args.prompt, args.seed)
    payload = json.dumps({"prompt": graph, "client_id": "krea2-smoke"}).encode()
    req = urllib.request.Request(
        f"{args.host}/prompt",
        data=payload,
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        resp = json.loads(r.read().decode())
    prompt_id = resp["prompt_id"]
    print(f"queued {prompt_id}")

    t0 = time.time()
    while True:
        with urllib.request.urlopen(f"{args.host}/history/{prompt_id}", timeout=30) as r:
            hist = json.loads(r.read().decode())
        if prompt_id in hist:
            status = hist[prompt_id].get("status", {})
            if status.get("completed") or status.get("status_str") in ("success", "error"):
                print(json.dumps(hist[prompt_id].get("outputs", {}), indent=2)[:2000])
                print("status:", status.get("status_str"), status.get("messages", [])[-3:])
                print(f"elapsed_sec={time.time() - t0:.1f}")
                return
        with urllib.request.urlopen(f"{args.host}/queue", timeout=30) as r:
            q = json.loads(r.read().decode())
        print(
            f"waiting... running={len(q.get('queue_running', []))} "
            f"pending={len(q.get('queue_pending', []))} "
            f"t={time.time() - t0:.0f}s"
        )
        time.sleep(3)


if __name__ == "__main__":
    main()
