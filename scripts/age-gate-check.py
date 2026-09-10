#!/usr/bin/env python3
"""
Local age gate for PeachBitch — runs on Railway (CPU), never on Metalnode GPU.

Usage:
  python3 scripts/age-gate-check.py /path/to/image.jpg
  python3 scripts/age-gate-check.py --stdin < image.jpg

Stdout JSON:
  { "ok": true, "blocked": false, "faces": 1, "ageLabel": "(25-32)", "score": 0.91, ... }
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.request
from pathlib import Path

# Gil Levi & Tal Hassner age buckets
AGE_BUCKETS = [
    "(0-2)",
    "(4-6)",
    "(8-12)",
    "(15-20)",
    "(25-32)",
    "(38-43)",
    "(48-53)",
    "(60-100)",
]

# Default: block obvious minors + teen bucket (18+ product safety margin)
DEFAULT_BLOCK = {"(0-2)", "(4-6)", "(8-12)", "(15-20)"}

MODEL_URLS = {
    # OpenCV face SSD
    "face.prototxt": "https://raw.githubusercontent.com/opencv/opencv/4.x/samples/dnn/face_detector/deploy.prototxt",
    "face.caffemodel": "https://raw.githubusercontent.com/opencv/opencv_3rdparty/dnn_samples_face_detector_20180205_fp16/res10_300x300_ssd_iter_140000_fp16.caffemodel",
    # Age net (Gil Levi) — weights usually hosted on Dropbox; prototxt on GitHub
    "age.prototxt": "https://raw.githubusercontent.com/spmallick/learnopencv/master/AgeGender/age_deploy.prototxt",
    "age.caffemodel": "https://www.dropbox.com/s/xfb20y596869vbb/age_net.caffemodel?dl=1",
}


def models_dir() -> Path:
    # AGE_GATE_MODELS may be the final models dir OR the data root.
    explicit = os.environ.get("AGE_GATE_MODELS")
    if explicit:
        p = Path(explicit)
        # If caller already pointed at .../age-gate, don't nest again.
        if p.name == "age-gate":
            p.mkdir(parents=True, exist_ok=True)
            return p
        p = p / "age-gate"
        p.mkdir(parents=True, exist_ok=True)
        return p
    root = os.environ.get("DATA_ROOT")
    if root:
        p = Path(root) / "age-gate"
    else:
        p = Path(os.getcwd()) / "data" / "age-gate"
    p.mkdir(parents=True, exist_ok=True)
    return p


def download(name: str, dest: Path) -> None:
    if dest.exists() and dest.stat().st_size > 1000:
        return
    url = MODEL_URLS[name]
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    try:
        if tmp.exists():
            tmp.unlink(missing_ok=True)
        urllib.request.urlretrieve(url, str(tmp))
        if tmp.stat().st_size < 1000:
            raise RuntimeError(f"download too small: {name}")
        tmp.replace(dest)
    except Exception:
        if tmp.exists():
            tmp.unlink(missing_ok=True)
        # Fallback: try GitHub LFS / alternate if Dropbox fails
        if name == "age.caffemodel":
            urllib.request.urlretrieve(
                "https://github.com/spmallick/learnopencv/raw/master/AgeGender/age_net.caffemodel",
                str(tmp),
            )
            tmp.replace(dest)
            return
        raise


def ensure_models(d: Path) -> dict[str, Path]:
    paths = {}
    for name in MODEL_URLS:
        dest = d / name
        download(name, dest)
        paths[name] = dest
    return paths


def load_image_bytes(data: bytes):
    import cv2
    import numpy as np

    arr = np.frombuffer(data, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise RuntimeError("cannot decode image")
    return img


def detect_faces(face_net, img, conf_thresh: float = 0.55):
    import cv2

    h, w = img.shape[:2]
    blob = cv2.dnn.blobFromImage(
        cv2.resize(img, (300, 300)), 1.0, (300, 300), (104.0, 177.0, 123.0)
    )
    face_net.setInput(blob)
    detections = face_net.forward()
    boxes = []
    for i in range(detections.shape[2]):
        conf = float(detections[0, 0, i, 2])
        if conf < conf_thresh:
            continue
        box = detections[0, 0, i, 3:7] * [w, h, w, h]
        x1, y1, x2, y2 = box.astype(int)
        x1, y1 = max(0, x1), max(0, y1)
        x2, y2 = min(w - 1, x2), min(h - 1, y2)
        if x2 - x1 < 20 or y2 - y1 < 20:
            continue
        boxes.append((x1, y1, x2, y2, conf))
    boxes.sort(key=lambda b: (b[2] - b[0]) * (b[3] - b[1]), reverse=True)
    return boxes


def predict_age(age_net, face_bgr):
    import cv2

    blob = cv2.dnn.blobFromImage(
        face_bgr, 1.0, (227, 227), (78.4263377603, 87.7689143744, 114.895847746), swapRB=False
    )
    age_net.setInput(blob)
    preds = age_net.forward()[0]
    idx = int(preds.argmax())
    return AGE_BUCKETS[idx], float(preds[idx]), idx


def analyze(img_bytes: bytes, block_buckets: set[str], face_thresh: float) -> dict:
    import cv2

    d = models_dir()
    paths = ensure_models(d)

    def load_caffe(prototxt: Path, caffemodel: Path):
        if hasattr(cv2.dnn, "readNetFromCaffe"):
            return cv2.dnn.readNetFromCaffe(str(prototxt), str(caffemodel))
        # OpenCV 5+ / some builds: use generic readNet
        return cv2.dnn.readNet(str(caffemodel), str(prototxt), "caffe")

    face_net = load_caffe(paths["face.prototxt"], paths["face.caffemodel"])
    age_net = load_caffe(paths["age.prototxt"], paths["age.caffemodel"])

    img = load_image_bytes(img_bytes)
    faces = detect_faces(face_net, img, face_thresh)
    if not faces:
        # No face → don't block (ID docs, etc.) but flag for ops
        return {
            "ok": True,
            "blocked": False,
            "faces": 0,
            "reason": "no_face",
            "ageLabel": None,
            "score": None,
            "engine": "opencv-dnn-age",
        }

    # Any face in blocked bucket → block (fail-closed for minors in frame)
    worst = None
    for x1, y1, x2, y2, fconf in faces:
        pad_w = int(0.1 * (x2 - x1))
        pad_h = int(0.1 * (y2 - y1))
        xa, ya = max(0, x1 - pad_w), max(0, y1 - pad_h)
        xb = min(img.shape[1] - 1, x2 + pad_w)
        yb = min(img.shape[0] - 1, y2 + pad_h)
        crop = img[ya:yb, xa:xb]
        label, score, idx = predict_age(age_net, crop)
        item = {
            "ageLabel": label,
            "score": round(score, 4),
            "bucketIndex": idx,
            "faceConfidence": round(float(fconf), 4),
            "blocked": label in block_buckets,
        }
        if worst is None or item["blocked"] or (
            not worst["blocked"] and idx < worst["bucketIndex"]
        ):
            worst = item
        if item["blocked"]:
            return {
                "ok": True,
                "blocked": True,
                "faces": len(faces),
                "reason": "probable_minor",
                "ageLabel": label,
                "score": round(score, 4),
                "bucketIndex": idx,
                "engine": "opencv-dnn-age",
                "face": item,
            }

    assert worst is not None
    return {
        "ok": True,
        "blocked": False,
        "faces": len(faces),
        "reason": "adult_ok",
        "ageLabel": worst["ageLabel"],
        "score": worst["score"],
        "bucketIndex": worst["bucketIndex"],
        "engine": "opencv-dnn-age",
        "face": worst,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("path", nargs="?", help="image path")
    parser.add_argument("--stdin", action="store_true")
    parser.add_argument(
        "--block",
        default=",".join(sorted(DEFAULT_BLOCK)),
        help="comma-separated age buckets to block",
    )
    parser.add_argument("--face-thresh", type=float, default=0.55)
    args = parser.parse_args()

    block = {b.strip() for b in args.block.split(",") if b.strip()}
    try:
        if args.stdin or not args.path:
            data = sys.stdin.buffer.read()
        else:
            data = Path(args.path).read_bytes()
        if len(data) < 50:
            raise RuntimeError("empty image")
        result = analyze(data, block, args.face_thresh)
    except Exception as e:
        result = {
            "ok": False,
            "blocked": False,
            "error": str(e),
            "engine": "opencv-dnn-age",
        }
        print(json.dumps(result, ensure_ascii=False))
        return 2

    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
