#!/usr/bin/env python3
"""Verify all node types used in PHOTO_BG workflow exist on Comfy."""
import json
import re
import urllib.parse
import urllib.request
from pathlib import Path

WF = Path("/work/ComfyUI/user/default/workflows/MiniMax_H3_Character_Ref2VA_PHOTO_BG.json")
COMFY = "http://127.0.0.1:8188"
UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    re.I,
)


def main():
    wf = json.loads(WF.read_text(encoding="utf-8"))
    types = sorted({n["type"] for n in wf.get("nodes", []) if n.get("mode", 0) != 4 and not UUID_RE.match(n["type"])})
    # include subgraph nodes
    for sg in wf.get("definitions", {}).get("subgraphs", []):
        for n in sg.get("nodes", []):
            if n.get("mode", 0) != 4:
                types.append(n["type"])
    types = sorted(set(types))

    missing = []
    for t in types:
        try:
            url = f"{COMFY}/object_info/{urllib.parse.quote(t, safe='')}"
            urllib.request.urlopen(url, timeout=15)
        except Exception:
            missing.append(t)

    if missing:
        print("FAIL missing node types:", missing)
        return 1
    print(f"OK all {len(types)} active node types registered")
    for t in types:
        print(" ", t)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
