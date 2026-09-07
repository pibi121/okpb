#!/usr/bin/env python3
import json
import urllib.request

def get(path):
    with urllib.request.urlopen(f"http://127.0.0.1:8188{path}", timeout=120) as r:
        return json.loads(r.read().decode())

info = get("/object_info")
for n in ["EmptySD3LatentImage", "LoraLoaderModelOnly", "Krea2EditModelPatch", "Krea2EditGroundedEncode"]:
    print(n, "OK" if n in info else "MISSING")

names = info["LoraLoaderModelOnly"]["input"]["required"]["lora_name"][0]
print("identity listed:", [n for n in names if "identity" in n.lower() or "krea2" in n.lower()])

# try refresh models endpoint if present
for path in ["/experimental/models/refresh", "/api/models/refresh", "/object_info"]:
    try:
        req = urllib.request.Request(f"http://127.0.0.1:8188{path}", data=b"{}", method="POST", headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=30) as r:
            print("POST", path, r.status)
    except Exception as e:
        print("POST", path, type(e).__name__, e)
