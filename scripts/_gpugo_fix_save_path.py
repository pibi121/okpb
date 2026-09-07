#!/usr/bin/env python3
"""
Fix All-in-One: Save/Preview must not depend only on bypassed Detailer/SeedVR chain.
Wire a direct Save from VAEDecode for first-gen testing.
Also un-bypass FilmGrain if it breaks post chain oddly - actually leave FilmGrain bypassed;
bypass should passthrough IMAGE on most nodes.
Primary fix: add/ensure Preview+Save linked from node 7 VAEDecode.
"""
import json
import os
import shutil
from pathlib import Path

import paramiko

PASSWORD = os.environ.get("GPUGO_PASS") or "C5FdcIQ5"
LOCAL = Path(r"C:\Users\Олег\Desktop\Z-Image-ALLinONE-v2.json")
LOCAL_COPY = Path(r"C:\Users\Олег\Desktop\Проект Х\peachbitch\workflows\Z-Image-ALLinONE-v2.json")


def fix_workflow(d: dict) -> dict:
    nodes = {n["id"]: n for n in d["nodes"]}
    links = d.setdefault("links", [])
    # links format: [link_id, from_node, from_slot, to_node, to_slot, type]
    max_link = max((L[0] for L in links), default=0)
    max_node = max((n["id"] for n in d["nodes"]), default=0)

    # Find VAEDecode IMAGE output slot
    vae = nodes[7]
    # outputs[0] should be IMAGE
    out_slot = 0
    for i, o in enumerate(vae.get("outputs") or []):
        if o.get("name") == "IMAGE" or o.get("type") == "IMAGE":
            out_slot = i
            break

    # 1) Un-bypass FilmGrain (150) - optional; bypass usually passthrough
    # 2) Create dedicated SaveImage for base output if not present
    # Reuse PreviewImage 262 if exists - rewire to VAEDecode

    def next_link():
        nonlocal max_link
        max_link += 1
        return max_link

    def next_node():
        nonlocal max_node
        max_node += 1
        return max_node

    def rewire_input(node_id, input_name, from_id, from_slot, typ="IMAGE"):
        n = nodes[node_id]
        for inp in n.get("inputs") or []:
            if inp.get("name") == input_name or (input_name == "images" and inp.get("name") in ("images", "image", "IMAGE")):
                old = inp.get("link")
                # remove old link entry
                if old is not None:
                    d["links"] = [L for L in d["links"] if L[0] != old]
                    # remove from source outputs.links
                    src = nodes.get(from_id)
                    # also clean old source
                    for nn in d["nodes"]:
                        for out in nn.get("outputs") or []:
                            if out.get("links") and old in out["links"]:
                                out["links"] = [x for x in out["links"] if x != old]
                lid = next_link()
                inp["link"] = lid
                d["links"].append([lid, from_id, from_slot, node_id, _input_slot_index(n, inp), typ])
                # add to source output links
                outs = nodes[from_id].setdefault("outputs", [])
                while len(outs) <= from_slot:
                    outs.append({"name": "IMAGE", "type": "IMAGE", "links": []})
                outs[from_slot].setdefault("links", [])
                if lid not in outs[from_slot]["links"]:
                    outs[from_slot]["links"].append(lid)
                return lid
        # add input if missing
        return None

    def _input_slot_index(n, inp):
        for i, x in enumerate(n.get("inputs") or []):
            if x is inp:
                return i
        return 0

    # Rewire SaveImage 265 (and Preview 262) directly to VAEDecode for reliable base output
    # Keep other saves as-is for full pipeline when detailers enabled
    for save_id in (265, 262):
        if save_id in nodes:
            rewire_input(save_id, "images", 7, out_slot)
            # ensure not bypassed
            nodes[save_id]["mode"] = 0
            if save_id == 265:
                nodes[save_id]["title"] = "Save BASE (VAEDecode)"
            if save_id == 262:
                nodes[save_id]["title"] = "Preview BASE (VAEDecode)"

    # Also rewire Save 120 to VAEDecode for simple path (was full post chain through bypassed detailers)
    if 120 in nodes:
        rewire_input(120, "images", 7, out_slot)
        nodes[120]["mode"] = 0
        nodes[120]["title"] = "Save BASE quick"

    # Un-bypass nothing in detailers - keep them off
    # Ensure core path not bypassed
    for nid in (1, 2, 3, 4, 5, 7, 60, 71, 72, 46, 230, 233, 181):
        if nid in nodes:
            nodes[nid]["mode"] = 0

    d["last_link_id"] = max_link
    d["last_node_id"] = max(d.get("last_node_id", 0), max_node)

    # Note for user
    note_id = next_node()
    d["nodes"].append(
        {
            "id": note_id,
            "type": "MarkdownNote",
            "pos": [-900, -200],
            "size": [400, 160],
            "flags": {},
            "order": 0,
            "mode": 0,
            "inputs": [],
            "outputs": [],
            "title": "READ ME",
            "properties": {},
            "widgets_values": [
                "### First test\n1. Check **Fast Groups Bypasser**: groups Z-Image + LOADERS must be ON (not bypassed).\n2. Queue — image should appear in **Save BASE** / Preview BASE.\n3. Detailer/SeedVR stay Bypass until you enable them."
            ],
        }
    )
    d["last_node_id"] = note_id
    return d


def main():
    raw = json.loads(LOCAL.read_text(encoding="utf-8"))
    fixed = fix_workflow(raw)
    text = json.dumps(fixed, ensure_ascii=False)
    LOCAL.write_text(text, encoding="utf-8")
    LOCAL_COPY.parent.mkdir(parents=True, exist_ok=True)
    LOCAL_COPY.write_text(text, encoding="utf-8")
    print("local saved", LOCAL, len(text))

    # upload to GPUGO
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(
        "95.165.71.177",
        port=42010,
        username="root",
        password=PASSWORD,
        timeout=60,
        allow_agent=False,
        look_for_keys=False,
    )
    sftp = c.open_sftp()
    for remote in (
        "/workspace/user/default/workflows/Z-Image-ALLinONE-v2.json",
        "/workspace/user/default/workflows/Z-Image ALLinONE v2.json",
    ):
        with sftp.file(remote, "w") as f:
            f.write(text)
        print("uploaded", remote)
    sftp.close()
    c.close()
    print("DONE")


if __name__ == "__main__":
    main()
