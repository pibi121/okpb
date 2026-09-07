#!/usr/bin/env python3
import json
import urllib.request

def show(model_id: int) -> None:
    with urllib.request.urlopen(f"https://civitai.com/api/v1/models/{model_id}", timeout=60) as r:
        m = json.loads(r.read().decode())
    print("MODEL", m["id"], m["name"])
    for v in m["modelVersions"][:10]:
        f = v["files"][0] if v.get("files") else {}
        print(
            v["id"],
            "|",
            v["name"],
            "|",
            f.get("name"),
            "|",
            round(f.get("sizeKB", 0) / 1024, 1),
            "MB",
            "|",
            f.get("downloadUrl") or v.get("downloadUrl"),
        )


if __name__ == "__main__":
    show(2725430)
    print("---")
    show(2728234)
