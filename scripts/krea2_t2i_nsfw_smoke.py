#!/usr/bin/env python3
"""Queue Krea2 Turbo NSFW T2I smoke test (NSFW LoRA + optional filterbypass)."""
import argparse
import json
import time
import urllib.request

DEFAULT_PROMPT = (
    "completely nude young woman standing in a bedroom, full body, "
    "bare breasts, nipples, natural soft window light, photorealistic skin, "
    "detailed anatomy, 85mm, shallow depth of field, nsfw"
)
DEFAULT_NEG = "clothes, underwear, bra, panties, mosaic, censored, blurry, deformed hands, extra limbs"


def build_prompt(
    unet: str,
    clip: str,
    vae: str,
    lora: str,
    bypass: str,
    text: str,
    neg: str,
    seed: int,
    lora_strength: float,
    bypass_strength: float,
) -> dict:
    graph = {
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
        "10": {
            "class_type": "LoraLoader",
            "inputs": {
                "model": ["1", 0],
                "clip": ["2", 0],
                "lora_name": lora,
                "strength_model": lora_strength,
                "strength_clip": lora_strength,
            },
        },
        "4": {
            "class_type": "CLIPTextEncode",
            "inputs": {"clip": ["2", 0], "text": text},
        },
        "5": {
            "class_type": "CLIPTextEncode",
            "inputs": {"clip": ["2", 0], "text": neg},
        },
        "6": {
            "class_type": "EmptyLatentImage",
            "inputs": {"width": 888, "height": 1176, "batch_size": 1},
        },
        "8": {
            "class_type": "VAEDecode",
            "inputs": {"samples": ["7", 0], "vae": ["3", 0]},
        },
        "9": {
            "class_type": "SaveImage",
            "inputs": {"images": ["8", 0], "filename_prefix": "krea2/t2i_nsfw"},
        },
    }

    model_src = ["10", 0]
    if bypass and bypass_strength != 0:
        graph["11"] = {
            "class_type": "LoraLoader",
            "inputs": {
                "model": ["10", 0],
                "clip": ["2", 0],
                "lora_name": bypass,
                "strength_model": bypass_strength,
                "strength_clip": bypass_strength,
            },
        }
        model_src = ["11", 0]

    graph["7"] = {
        "class_type": "KSampler",
        "inputs": {
            "model": model_src,
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
    }
    return graph


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--host", default="http://127.0.0.1:8188")
    p.add_argument("--unet", default="krea2/krea2_turbo_fp8_scaled.safetensors")
    p.add_argument("--clip", default="Huihui-Qwen3-VL-4B-Instruct-abliterated.safetensors")
    p.add_argument("--vae", default="wan_2.1_vae.safetensors")
    p.add_argument("--lora", default="krea2/KNPV4.1_pre.safetensors")
    p.add_argument("--bypass", default="")
    p.add_argument("--lora-strength", type=float, default=1.0)
    p.add_argument("--bypass-strength", type=float, default=0.0)
    p.add_argument("--prompt", default=DEFAULT_PROMPT)
    p.add_argument("--negative", default=DEFAULT_NEG)
    p.add_argument("--seed", type=int, default=42)
    args = p.parse_args()

    graph = build_prompt(
        args.unet,
        args.clip,
        args.vae,
        args.lora,
        args.bypass,
        args.prompt,
        args.negative,
        args.seed,
        args.lora_strength,
        args.bypass_strength,
    )
    payload = json.dumps({"prompt": graph, "client_id": "krea2-nsfw-smoke"}).encode()
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
                print("status:", status.get("status_str"), status.get("messages", [])[-5:])
                print(f"elapsed_sec={time.time() - t0:.1f}")
                if status.get("status_str") == "error":
                    raise SystemExit(1)
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
