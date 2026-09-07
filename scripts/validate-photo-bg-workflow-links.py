#!/usr/bin/env python3
"""Verify PHOTO_BG workflow wiring (masking + ref_video batch path)."""
import json
import sys
from pathlib import Path

WF = Path(sys.argv[1] if len(sys.argv) > 1 else "MiniMax_H3_Character_Ref2VA_PHOTO_BG.json")


def link_map(wf):
    m = {}
    for entry in wf.get("links", []):
        lid, src, src_slot, dst, dst_slot, typ = entry
        m[lid] = {"src": src, "src_slot": src_slot, "dst": dst, "dst_slot": dst_slot, "type": typ}
    return m


def node_by_id(wf):
    return {n["id"]: n for n in wf.get("nodes", [])}


def input_link(node, name):
    for inp in node.get("inputs") or []:
        if inp.get("name") == name:
            return inp.get("link")
    return None


def main():
    wf = json.loads(WF.read_text(encoding="utf-8"))
    nodes = node_by_id(wf)
    links = link_map(wf)
    errors = []

    muted = {nid for nid, n in nodes.items() if n.get("mode") == 4}
    for nid in (503, 519, 457):
        if nid in nodes and nid not in muted:
            errors.append(f"node {nid} ({nodes[nid]['type']}) should be muted (bypassed)")

    # Composite: video batch base + scaled photo + inverted mask
    comp = nodes.get(454)
    if not comp or comp.get("type") != "ImageCompositeMasked":
        errors.append("missing node 454 ImageCompositeMasked")
    else:
        dest = input_link(comp, "destination")
        src = input_link(comp, "source")
        mask = input_link(comp, "mask")
        if dest != 677 or links.get(677, {}).get("src") != 460:
            errors.append(f"454 destination must be video frames (460), got link {dest}")
        if src != 779 or links.get(779, {}).get("src") != 526:
            errors.append(f"454 source must be scaled photo (526), got link {src}")
        if mask != 787 or links.get(787, {}).get("src") != 528:
            errors.append(f"454 mask must be inverted SAM3 (528), got link {mask}")

    scale_px = nodes.get(456)
    ref2v = nodes.get(464)
    if scale_px and ref2v:
        ref_vid = input_link(ref2v, "ref_videos.ref_video_0")
        out_links = scale_px.get("outputs", [{}])[0].get("links") or []
        if ref_vid != 785 or 785 not in out_links:
            errors.append(f"464 ref_video_0 must come from 456 via link 785 (got {ref_vid})")
        if links.get(785, {}).get("dst") != 464:
            errors.append("link 785 must target node 464")

    load_img = nodes.get(496)
    if load_img and ref2v:
        ref1 = input_link(ref2v, "ref_images.ref_image_1")
        if ref1 != 781 or links.get(781, {}).get("src") != 496:
            errors.append(f"464 ref_image_1 must be LoadImage 496 (got link {ref1})")

    if errors:
        print("FAIL workflow links:")
        for e in errors:
            print(" ", e)
        return 1

    print("OK PHOTO_BG workflow links verified")
    print("  composite: 460(video) + 526(photo) mask 528(inverted SAM3)")
    print("  ref_video: 456 -> 464 (bypasses PreviewImage batch collapse)")
    print("  sage bypass: nodes 503, 519, 457 muted")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
