#!/usr/bin/env python3
"""Test 2-stage pipeline: raw-photo img2img (pose/body) + FaceDetailer high-denoise (identity override)."""
from pathlib import Path
import sys
import paramiko

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

HOST = "77.94.203.13"
PORT = 22024
KEY = Path(r"C:\Users\Олег\Downloads\metalnode_id_ed25519 (4).txt")
USER = "root"

REF_IMAGE = "(m=eaAaGwObaaaa)(mh=_YY1wUNGNfw2ea1L)4.jpg"
PROMPT_TEXT = "Photorealistic erotic photo at night, warm bedside lamp. olh_person petite nude woman lying on her back on the bed. Bald muscular man on top in missionary between her legs, his cock inside her. Both faces visible, she looks up at him. Messy sheets, natural skin, shallow DOF. Only two people."

FD_DENOISE = 0.8

PROMPT = {
    "102": {"class_type": "VAELoader", "inputs": {"vae_name": "flux2-vae.safetensors"}},
    "126": {"class_type": "UNETLoader", "inputs": {"unet_name": "flux-2-klein-9b-fp8.safetensors", "weight_dtype": "default"}},
    "136": {"class_type": "CLIPLoader", "inputs": {"clip_name": "qwen_3_8b_fp8mixed.safetensors", "type": "flux2", "device": "default"}},
    "200": {"class_type": "LoraLoaderModelOnly", "inputs": {"model": ["126", 0], "lora_name": "klein_snofs_v1_4.safetensors", "strength_model": 0.85}},
    "201": {"class_type": "LoraLoaderModelOnly", "inputs": {"model": ["200", 0], "lora_name": "lenovo_flux_klein9b.safetensors", "strength_model": 0.85}},
    "107": {"class_type": "CLIPTextEncode", "inputs": {"clip": ["136", 0], "text": PROMPT_TEXT}},
    "100": {"class_type": "FluxGuidance", "inputs": {"conditioning": ["107", 0], "guidance": 4}},
    "135": {"class_type": "ConditioningZeroOut", "inputs": {"conditioning": ["107", 0]}},
    "301": {"class_type": "LoadImage", "inputs": {"image": REF_IMAGE}},
    "310": {"class_type": "ImageScale", "inputs": {"image": ["301", 0], "upscale_method": "lanczos", "width": 1024, "height": 1024, "crop": "center"}},
    "311": {"class_type": "VAEEncode", "inputs": {"pixels": ["310", 0], "vae": ["102", 0]}},
    # stage 1 - body/pose from reference
    "134": {"class_type": "KSampler", "inputs": {"model": ["201", 0], "positive": ["100", 0], "negative": ["135", 0], "latent_image": ["311", 0], "seed": 445566778, "steps": 8, "cfg": 1.3, "sampler_name": "euler", "scheduler": "simple", "denoise": 0.65}},
    "104": {"class_type": "VAEDecode", "inputs": {"samples": ["134", 0], "vae": ["102", 0]}},
    "9": {"class_type": "SaveImage", "inputs": {"images": ["104", 0], "filename_prefix": "Flux2_STAGE1_body"}},
    # stage 2 - FaceDetailer, high denoise -> identity fully from LoRA/prompt, body untouched
    "400": {"class_type": "UltralyticsDetectorProvider", "inputs": {"model_name": "bbox/face_yolov8m.pt"}},
    "401": {
        "class_type": "FaceDetailer",
        "inputs": {
            "image": ["104", 0],
            "model": ["201", 0],
            "clip": ["136", 0],
            "vae": ["102", 0],
            "guide_size": 512,
            "guide_size_for": True,
            "max_size": 1024,
            "seed": 998877,
            "steps": 10,
            "cfg": 1.3,
            "sampler_name": "euler",
            "scheduler": "simple",
            "positive": ["100", 0],
            "negative": ["135", 0],
            "denoise": FD_DENOISE,
            "feather": 5,
            "noise_mask": True,
            "force_inpaint": True,
            "bbox_threshold": 0.5,
            "bbox_dilation": 10,
            "bbox_crop_factor": 3.0,
            "sam_detection_hint": "center-1",
            "sam_dilation": 0,
            "sam_threshold": 0.93,
            "sam_bbox_expansion": 0,
            "sam_mask_hint_threshold": 0.7,
            "sam_mask_hint_use_negative": "False",
            "drop_size": 10,
            "bbox_detector": ["400", 0],
            "wildcard": "",
            "cycle": 1,
        },
    },
    "9b": {"class_type": "SaveImage", "inputs": {"images": ["401", 0], "filename_prefix": "Flux2_STAGE2_facefix"}},
}

REMOTE = r'''
import json, urllib.request, time

prompt = %s

req = urllib.request.Request(
    "http://127.0.0.1:8188/prompt",
    data=json.dumps({"prompt": prompt, "client_id": "facedetailer_test"}).encode(),
    headers={"Content-Type": "application/json"},
)
try:
    resp = urllib.request.urlopen(req, timeout=30)
    result = json.loads(resp.read())
    print("SUBMIT_OK", json.dumps(result))
    prompt_id = result.get("prompt_id")
except urllib.error.HTTPError as e:
    body = e.read().decode(errors="replace")
    print("SUBMIT_HTTP_ERROR", e.code)
    print(body[:4000])
    prompt_id = None
except Exception as e:
    print("SUBMIT_ERROR", repr(e))
    prompt_id = None

if prompt_id:
    print("PROMPT_ID", prompt_id)
    for i in range(90):
        time.sleep(4)
        try:
            h = json.loads(urllib.request.urlopen(f"http://127.0.0.1:8188/history/{prompt_id}", timeout=15).read())
        except Exception as e:
            print("poll error", e)
            continue
        if prompt_id in h:
            entry = h[prompt_id]
            status = entry.get("status", {})
            status_str = status.get("status_str")
            completed = status.get("completed")
            print(f"[{(i+1)*4}s] status_str={status_str} completed={completed}")
            if completed is not None:
                outputs = entry.get("outputs", {})
                print("OUTPUTS", json.dumps(outputs)[:2000])
                if status_str == "error":
                    for m in status.get("messages", []):
                        if m[0] == "execution_error":
                            print("EXC_NODE", m[1].get("node_id"), m[1].get("node_type"))
                            print("EXC", m[1].get("exception_message"))
                            print("TB", "".join(m[1].get("traceback", []))[-3000:])
                break
    else:
        print("TIMEOUT waiting for completion")
'''


def main():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    pkey = paramiko.Ed25519Key.from_private_key_file(str(KEY))
    client.connect(HOST, port=PORT, username=USER, pkey=pkey, timeout=30, allow_agent=False, look_for_keys=False)

    sftp = client.open_sftp()
    with sftp.file("/work/_fd_test_queue.py", "w") as f:
        f.write(REMOTE % repr(PROMPT))
    sftp.close()

    stdin, stdout, stderr = client.exec_command("python3 /work/_fd_test_queue.py", timeout=420)
    print(stdout.read().decode(errors="replace"))
    err = stderr.read().decode(errors="replace")
    if err.strip():
        print("STDERR:", err)
    client.close()


if __name__ == "__main__":
    main()
