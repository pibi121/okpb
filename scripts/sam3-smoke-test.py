#!/usr/bin/env python3
"""Minimal SAM3 smoke test on Comfy (Blackwell / RTX 5090)."""
import json
import time
import urllib.error
import urllib.request

COMFY = "http://127.0.0.1:8188"
IMAGE = "Flux2_dev_00018_.png"
CKPT = "sam3.1_multiplex_fp16.safetensors"

prompt = {
    "1": {
        "class_type": "CheckpointLoaderSimple",
        "inputs": {"ckpt_name": CKPT},
    },
    "2": {
        "class_type": "LoadImage",
        "inputs": {"image": IMAGE},
    },
    "3": {
        "class_type": "CLIPTextEncode",
        "inputs": {"text": "The woman", "clip": ["1", 1]},
    },
    "4": {
        "class_type": "SAM3_Detect",
        "inputs": {
            "model": ["1", 0],
            "image": ["2", 0],
            "conditioning": ["3", 0],
            "threshold": 0.5,
            "refine_iterations": 1,
            "individual_masks": False,
        },
    },
    "5": {
        "class_type": "MaskToImage",
        "inputs": {"mask": ["4", 0]},
    },
    "6": {
        "class_type": "SaveImage",
        "inputs": {"filename_prefix": "sam3_smoke", "images": ["5", 0]},
    },
}


def post(path: str, body: dict) -> dict:
    data = json.dumps(body).encode()
    req = urllib.request.Request(
        f"{COMFY}{path}",
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        return json.loads(resp.read())


def get(path: str) -> dict:
    with urllib.request.urlopen(f"{COMFY}{path}", timeout=30) as resp:
        return json.loads(resp.read())


def main() -> int:
    try:
        hist = get("/history")
        if not isinstance(hist, dict):
            print("WARN: unexpected history shape")
    except Exception as e:
        print(f"FAIL: Comfy not reachable: {e}")
        return 1

    client_id = "sam3-smoke-test"
    payload = {"prompt": prompt, "client_id": client_id}
    try:
        res = post("/prompt", payload)
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors="replace")
        print(f"FAIL: queue rejected ({e.code}): {body[:2000]}")
        return 1

    prompt_id = res.get("prompt_id")
    print(f"queued prompt_id={prompt_id}")

    deadline = time.time() + 180
    while time.time() < deadline:
        time.sleep(2)
        hist = get("/history")
        if prompt_id not in hist:
            continue
        entry = hist[prompt_id]
        status = entry.get("status", {})
        if status.get("completed"):
            outputs = entry.get("outputs", {})
            print(f"OK: SAM3 completed outputs={list(outputs.keys())}")
            return 0
        if status.get("status_str") == "error":
            msgs = status.get("messages", [])
            print(f"FAIL: execution error: {json.dumps(msgs, ensure_ascii=False)[:3000]}")
            return 1

    print("FAIL: timeout waiting for SAM3")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
