#!/usr/bin/env python3
"""Test depth-map-based img2img (structure-only, no facial/identity pixels) as fix for identity bleed."""
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

def build_prompt(source_node_id, denoise, seed, prefix):
    return {
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
        "320": {"class_type": "DepthAnythingV2Preprocessor", "inputs": {"image": ["310", 0], "ckpt_name": "depth_anything_v2_vitl.pth", "resolution": 1024}},
        "321": {"class_type": "DWPreprocessor", "inputs": {"image": ["310", 0], "detect_hand": "enable", "detect_body": "enable", "detect_face": "enable", "resolution": 1024, "bbox_detector": "yolox_l.onnx", "pose_estimator": "dw-ll_ucoco_384_bs5.torchscript.pt", "scale_stick_for_xinsr_cn": "disable"}},
        "311": {"class_type": "VAEEncode", "inputs": {"pixels": [source_node_id, 0], "vae": ["102", 0]}},
        "312": {"class_type": "PreviewImage", "inputs": {"images": [source_node_id, 0]}},
        "134": {"class_type": "KSampler", "inputs": {"model": ["201", 0], "positive": ["100", 0], "negative": ["135", 0], "latent_image": ["311", 0], "seed": seed, "steps": 8, "cfg": 1.3, "sampler_name": "euler", "scheduler": "simple", "denoise": denoise}},
        "104": {"class_type": "VAEDecode", "inputs": {"samples": ["134", 0], "vae": ["102", 0]}},
        "9": {"class_type": "SaveImage", "inputs": {"images": ["104", 0], "filename_prefix": prefix}},
    }

TESTS = [
    ("320", 0.55, 111222333, "Flux2_DEPTH_D055"),
    ("320", 0.72, 111222334, "Flux2_DEPTH_D072"),
    ("321", 0.55, 111222335, "Flux2_SKEL_D055"),
    ("321", 0.72, 111222336, "Flux2_SKEL_D072"),
]

REMOTE_TPL = r'''
import json, urllib.request, time

prompt = %s

req = urllib.request.Request(
    "http://127.0.0.1:8188/prompt",
    data=json.dumps({"prompt": prompt, "client_id": "depth_i2i_test"}).encode(),
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
    for i in range(60):
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
                print("OUTPUTS", json.dumps(outputs)[:1500])
                if status_str == "error":
                    for m in status.get("messages", []):
                        if m[0] == "execution_error":
                            print("EXC", m[1].get("exception_message"))
                break
    else:
        print("TIMEOUT waiting for completion")
'''


def main():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    pkey = paramiko.Ed25519Key.from_private_key_file(str(KEY))
    client.connect(HOST, port=PORT, username=USER, pkey=pkey, timeout=30, allow_agent=False, look_for_keys=False)

    for source_node, denoise, seed, prefix in TESTS:
        print(f"\n=== {prefix} (source={source_node}, denoise={denoise}) ===")
        p = build_prompt(source_node, denoise, seed, prefix)
        sftp = client.open_sftp()
        with sftp.file("/work/_depth_i2i_test_run.py", "w") as f:
            f.write(REMOTE_TPL % repr(p))
        sftp.close()
        stdin, stdout, stderr = client.exec_command("python3 /work/_depth_i2i_test_run.py", timeout=300)
        print(stdout.read().decode(errors="replace"))
        err = stderr.read().decode(errors="replace")
        if err.strip():
            print("STDERR:", err)

    client.close()


if __name__ == "__main__":
    main()
