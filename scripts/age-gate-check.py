#!/usr/bin/env python3
"""
Local age gate for PeachBitch — runs on Railway (CPU), never on Metalnode GPU.

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

# Clear child buckets only. (15-20) is too noisy on adults — do not block by default.
DEFAULT_BLOCK = {"(0-2)", "(4-6)", "(8-12)"}
CHILD_BUCKETS = {"(0-2)", "(4-6)", "(8-12)"}
TEEN_BUCKET = "(15-20)"

# Expected model sizes (reject HTML/LFS stubs)
MIN_MODEL_BYTES = {
    "face.prototxt": 2_000,
    "face.caffemodel": 2_000_000,
    "age.prototxt": 1_500,
    "age.caffemodel": 40_000_000,
}

MODEL_URLS = {
    "face.prototxt": [
        "https://raw.githubusercontent.com/opencv/opencv/4.x/samples/dnn/face_detector/deploy.prototxt",
    ],
    "face.caffemodel": [
        "https://raw.githubusercontent.com/opencv/opencv_3rdparty/dnn_samples_face_detector_20180205_fp16/res10_300x300_ssd_iter_140000_fp16.caffemodel",
    ],
    "age.prototxt": [
        "https://raw.githubusercontent.com/spmallick/learnopencv/master/AgeGender/age_deploy.prototxt",
    ],
    # Prefer non-LFS mirrors with the real ~45.6MB weights
    "age.caffemodel": [
        "https://raw.githubusercontent.com/eveningglow/age-and-gender-classification/master/model/age_net.caffemodel",
        "https://github.com/habom2310/People-tracking-with-Age-and-Gender-detection/raw/master/age_gender_models/age_net.caffemodel",
        "https://www.dropbox.com/s/xfb20y596869vbb/age_net.caffemodel?dl=1",
    ],
}


def models_dir() -> Path:
    explicit = os.environ.get("AGE_GATE_MODELS")
    if explicit:
        p = Path(explicit)
        if p.name != "age-gate":
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


def _looks_like_html(path: Path) -> bool:
    try:
        head = path.read_bytes()[:200].lower()
        return b"<html" in head or b"<!doctype" in head or b"git-lfs" in head
    except Exception:
        return False


def download(name: str, dest: Path) -> None:
    min_size = MIN_MODEL_BYTES.get(name, 1000)
    if dest.exists() and dest.stat().st_size >= min_size and not _looks_like_html(dest):
        return
    if dest.exists():
        dest.unlink(missing_ok=True)

    urls = MODEL_URLS[name]
    dest.parent.mkdir(parents=True, exist_ok=True)
    last_err: Exception | None = None
    for url in urls:
        tmp = dest.with_suffix(dest.suffix + ".part")
        try:
            if tmp.exists():
                tmp.unlink(missing_ok=True)
            urllib.request.urlretrieve(url, str(tmp))
            size = tmp.stat().st_size
            if size < min_size or _looks_like_html(tmp):
                raise RuntimeError(f"bad download {name} from {url}: size={size}")
            tmp.replace(dest)
            return
        except Exception as e:
            last_err = e
            if tmp.exists():
                tmp.unlink(missing_ok=True)
    raise RuntimeError(f"failed to download {name}: {last_err}")


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


def detect_faces(face_net, img, conf_thresh: float = 0.6):
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
        if x2 - x1 < 40 or y2 - y1 < 40:
            continue
        boxes.append((x1, y1, x2, y2, conf))
    boxes.sort(key=lambda b: (b[2] - b[0]) * (b[3] - b[1]), reverse=True)
    return boxes


def predict_age(age_net, face_bgr):
    import cv2
    import numpy as np

    blob = cv2.dnn.blobFromImage(
        face_bgr, 1.0, (227, 227), (78.4263377603, 87.7689143744, 114.895847746), swapRB=False
    )
    age_net.setInput(blob)
    preds = age_net.forward()[0]
    preds = np.asarray(preds, dtype=float).reshape(-1)
    idx = int(preds.argmax())
    score = float(preds[idx])
    # second-best for margin checks
    order = list(preds.argsort()[::-1])
    second_idx = int(order[1]) if len(order) > 1 else idx
    second_score = float(preds[second_idx])
    return AGE_BUCKETS[idx], score, idx, AGE_BUCKETS[second_idx], second_score


def should_block(
    label: str,
    score: float,
    second_label: str,
    second_score: float,
    block_buckets: set[str],
    min_score: float,
) -> bool:
    if label not in block_buckets:
        return False
    if score < min_score:
        return False
    # Clear children: block when confident enough
    if label in CHILD_BUCKETS:
        return score >= min_score
    # Teen bucket is noisy — only if very confident AND 2nd isn't clearly adult
    if label == TEEN_BUCKET:
        adultish = second_label in {"(25-32)", "(38-43)", "(48-53)", "(60-100)"}
        if adultish and second_score >= 0.15:
            return False
        return score >= max(0.85, min_score)
    return score >= min_score


def analyze(
    img_bytes: bytes,
    block_buckets: set[str],
    face_thresh: float,
    min_score: float = 0.55,
) -> dict:
    import cv2

    d = models_dir()
    paths = ensure_models(d)

    def load_caffe(prototxt: Path, caffemodel: Path):
        if hasattr(cv2.dnn, "readNetFromCaffe"):
            return cv2.dnn.readNetFromCaffe(str(prototxt), str(caffemodel))
        return cv2.dnn.readNet(str(caffemodel), str(prototxt), "caffe")

    face_net = load_caffe(paths["face.prototxt"], paths["face.caffemodel"])
    age_net = load_caffe(paths["age.prototxt"], paths["age.caffemodel"])

    img = load_image_bytes(img_bytes)
    faces = detect_faces(face_net, img, face_thresh)
    if not faces:
        return {
            "ok": True,
            "blocked": False,
            "faces": 0,
            "reason": "no_face",
            "ageLabel": None,
            "score": None,
            "engine": "opencv-dnn-age",
            "models": {k: paths[k].stat().st_size for k in paths},
        }

    # Only the largest face (reference selfie). Avoid false boxes aged as kids.
    faces = faces[:1]

    x1, y1, x2, y2, fconf = faces[0]
    pad_w = int(0.15 * (x2 - x1))
    pad_h = int(0.15 * (y2 - y1))
    xa, ya = max(0, x1 - pad_w), max(0, y1 - pad_h)
    xb = min(img.shape[1] - 1, x2 + pad_w)
    yb = min(img.shape[0] - 1, y2 + pad_h)
    crop = img[ya:yb, xa:xb]
    label, score, idx, second_label, second_score = predict_age(age_net, crop)
    blocked = should_block(label, score, second_label, second_score, block_buckets, min_score)
    item = {
        "ageLabel": label,
        "score": round(score, 4),
        "bucketIndex": idx,
        "secondLabel": second_label,
        "secondScore": round(second_score, 4),
        "faceConfidence": round(float(fconf), 4),
        "blocked": blocked,
    }
    return {
        "ok": True,
        "blocked": blocked,
        "faces": 1,
        "reason": "probable_minor" if blocked else "adult_ok",
        "ageLabel": label,
        "score": round(score, 4),
        "bucketIndex": idx,
        "engine": "opencv-dnn-age",
        "face": item,
        "models": {k: paths[k].stat().st_size for k in paths},
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
    parser.add_argument("--face-thresh", type=float, default=0.6)
    parser.add_argument("--min-score", type=float, default=0.55)
    parser.add_argument("--force-redownload", action="store_true")
    args = parser.parse_args()

    if args.force_redownload:
        d = models_dir()
        for name in MODEL_URLS:
            p = d / name
            if p.exists():
                p.unlink(missing_ok=True)

    block = {b.strip() for b in args.block.split(",") if b.strip()}
    try:
        if args.stdin or not args.path:
            data = sys.stdin.buffer.read()
        else:
            data = Path(args.path).read_bytes()
        if len(data) < 50:
            raise RuntimeError("empty image")
        result = analyze(data, block, args.face_thresh, args.min_score)
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
