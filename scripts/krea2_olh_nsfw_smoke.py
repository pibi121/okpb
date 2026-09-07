#!/usr/bin/env python3
"""Smoke: Krea2 Turbo + olh_person_krea2 + KNPV4.1 NSFW."""
import json
import time
import urllib.request

PROMPT = (
    "olh_person, completely nude young woman standing in a bedroom, full body, "
    "bare breasts, nipples, natural soft window light, photorealistic skin texture, "
    "visible pores, detailed anatomy, 85mm, shallow depth of field, nsfw"
)
NEG = "clothes, underwear, bra, panties, mosaic, censored, blurry, deformed hands, extra limbs, plastic skin"

graph = {
    "1": {"class_type": "UNETLoader", "inputs": {"unet_name": "krea2/krea2_turbo_fp8_scaled.safetensors", "weight_dtype": "default"}},
    "2": {"class_type": "CLIPLoader", "inputs": {"clip_name": "Huihui-Qwen3-VL-4B-Instruct-abliterated.safetensors", "type": "krea2", "device": "default"}},
    "3": {"class_type": "VAELoader", "inputs": {"vae_name": "wan_2.1_vae.safetensors"}},
    "10": {
        "class_type": "LoraLoader",
        "inputs": {
            "model": ["1", 0],
            "clip": ["2", 0],
            "lora_name": "krea2/olh_person_krea2.safetensors",
            "strength_model": 1.0,
            "strength_clip": 1.0,
        },
    },
    "12": {
        "class_type": "LoraLoader",
        "inputs": {
            "model": ["10", 0],
            "clip": ["2", 0],
            "lora_name": "krea2/KNPV4.1_pre.safetensors",
            "strength_model": 1.0,
            "strength_clip": 1.0,
        },
    },
    "4": {"class_type": "CLIPTextEncode", "inputs": {"clip": ["2", 0], "text": PROMPT}},
    "5": {"class_type": "CLIPTextEncode", "inputs": {"clip": ["2", 0], "text": NEG}},
    "6": {"class_type": "EmptyLatentImage", "inputs": {"width": 888, "height": 1176, "batch_size": 1}},
    "7": {
        "class_type": "KSampler",
        "inputs": {
            "model": ["12", 0],
            "positive": ["4", 0],
            "negative": ["5", 0],
            "latent_image": ["6", 0],
            "seed": 42,
            "steps": 12,
            "cfg": 1.0,
            "sampler_name": "euler",
            "scheduler": "normal",
            "denoise": 1.0,
        },
    },
    "8": {"class_type": "VAEDecode", "inputs": {"samples": ["7", 0], "vae": ["3", 0]}},
    "9": {"class_type": "SaveImage", "inputs": {"images": ["8", 0], "filename_prefix": "krea2/olh_nsfw_smoke"}},
}

payload = json.dumps({"prompt": graph, "client_id": "olh-krea2-smoke"}).encode()
req = urllib.request.Request("http://127.0.0.1:8188/prompt", data=payload, headers={"Content-Type": "application/json"})
with urllib.request.urlopen(req, timeout=60) as r:
    resp = json.loads(r.read().decode())
pid = resp["prompt_id"]
print("queued", pid)
t0 = time.time()
while True:
    with urllib.request.urlopen(f"http://127.0.0.1:8188/history/{pid}", timeout=30) as r:
        hist = json.loads(r.read().decode())
    if pid in hist:
        st = hist[pid].get("status", {})
        if st.get("completed") or st.get("status_str") in ("success", "error"):
            print(json.dumps(hist[pid].get("outputs", {}), indent=2)[:1500])
            print("status:", st.get("status_str"), st.get("messages", [])[-3:])
            print(f"elapsed_sec={time.time()-t0:.1f}")
            raise SystemExit(0 if st.get("status_str") == "success" else 1)
    time.sleep(3)
    print(f"waiting... t={time.time()-t0:.0f}s")
