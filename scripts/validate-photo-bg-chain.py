#!/usr/bin/env python3
"""Validate PHOTO_BG masking chain produces >=5 ref_video frames on Comfy GPU."""
import json
import time
import urllib.error
import urllib.request
from pathlib import Path

COMFY = "http://127.0.0.1:8188"
IMAGE = "Flux2_dev_00018_.png"
VIDEO = "97cd212cfc716511f0c95b2ecbf26887_720w.mp4"

# Minimal chain mirroring PHOTO_BG masking → ref_video frame count check
prompt = {
    "1": {"class_type": "LoadImage", "inputs": {"image": IMAGE}},
    "2": {"class_type": "LoadVideo", "inputs": {"file": VIDEO}},
    "3": {"class_type": "GetVideoComponents", "inputs": {"video": ["2", 0]}},
    "4": {"class_type": "GetImageSize", "inputs": {"image": ["3", 0]}},
    "5": {
        "class_type": "ImageScale",
        "inputs": {
            "image": ["1", 0],
            "width": ["4", 0],
            "height": ["4", 1],
            "upscale_method": "lanczos",
            "crop": "center",
        },
    },
    "6": {
        "class_type": "SolidMask",
        "inputs": {
            "value": 0.5,
            "width": ["4", 0],
            "height": ["4", 1],
        },
    },
    "7": {"class_type": "InvertMask", "inputs": {"mask": ["6", 0]}},
    "8": {
        "class_type": "ImageCompositeMasked",
        "inputs": {
            "destination": ["3", 0],
            "source": ["5", 0],
            "x": 0,
            "y": 0,
            "resize_source": False,
            "mask": ["7", 0],
        },
    },
    "9": {
        "class_type": "ImageScaleToTotalPixels",
        "inputs": {
            "image": ["8", 0],
            "upscale_method": "nearest-exact",
            "megapixels": 0.15,
            "resolution_steps": 1,
        },
    },
    "11": {
        "class_type": "ImageFromBatch",
        "inputs": {"image": ["9", 0], "batch_index": 4, "length": 1},
    },
    "10": {"class_type": "SaveImage", "inputs": {"filename_prefix": "photo_bg_validate", "images": ["11", 0]}},
}


def post(path, body):
    data = json.dumps(body).encode()
    req = urllib.request.Request(
        f"{COMFY}{path}",
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        return json.loads(resp.read())


def get(path):
    with urllib.request.urlopen(f"{COMFY}{path}", timeout=30) as resp:
        return json.loads(resp.read())


def main():
    required = [
        "LoadImage",
        "LoadVideo",
        "GetVideoComponents",
        "ImageScale",
        "InvertMask",
        "ImageCompositeMasked",
        "ImageScaleToTotalPixels",
        "ImageFromBatch",
    ]
    missing = []
    for node in required:
        try:
            get(f"/object_info/{node}")
        except Exception:
            missing.append(node)
    if missing:
        print(f"FAIL missing nodes: {missing}")
        return 1

    try:
        res = post("/prompt", {"prompt": prompt, "client_id": "photo-bg-validate"})
    except urllib.error.HTTPError as e:
        print(f"FAIL queue: {e.read().decode(errors='replace')[:1500]}")
        return 1

    pid = res["prompt_id"]
    print(f"queued {pid}")

    deadline = time.time() + 120
    while time.time() < deadline:
        time.sleep(2)
        hist = get("/history").get(pid)
        if not hist:
            continue
        st = hist.get("status", {})
        if st.get("completed"):
            imgs = hist.get("outputs", {}).get("10", {}).get("images", [])
            print(f"OK composite chain: batch has >=5 frames (index 4 ok), saved {len(imgs)} image(s)")
            return 0 if imgs else 1
        if st.get("status_str") == "error":
            print(f"FAIL: {json.dumps(st.get('messages', []), ensure_ascii=False)[:2000]}")
            return 1

    print("FAIL timeout")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
