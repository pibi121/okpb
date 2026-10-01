#!/usr/bin/env python3
"""
Local age gate for PeachBitch — runs on Railway (CPU), never on Metalnode GPU.

Engines:
  opencv      — Gil Levi DNN age buckets (default)
  insightface — buffalo genderage.onnx continuous age years
                + SCRFD-500M face det + Attribute pad 1.5
                (no extra Gil Levi step)

Stdout JSON:
  { "ok": true, "blocked": false, "uncertain": false, "faces": 1,
    "ageLabel": "(25-32)", "score": 0.91, "reason": "adult_ok", ... }
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

CHILD_BUCKETS = {"(0-2)", "(4-6)", "(8-12)"}
TEEN_BUCKET = "(15-20)"
ADULT_BUCKETS = {"(25-32)", "(38-43)", "(48-53)", "(60-100)"}

# Default hard-block buckets (child only). Teen is uncertain, not hard-block.
DEFAULT_BLOCK = set(CHILD_BUCKETS)

# Expected model sizes (reject HTML/LFS stubs)
MIN_MODEL_BYTES = {
    "face.prototxt": 2_000,
    "face.caffemodel": 2_000_000,
    "age.prototxt": 1_500,
    "age.caffemodel": 40_000_000,
    "genderage.onnx": 1_200_000,
    "det_500m.onnx": 2_000_000,
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

GENDERAGE_URLS = [
    "https://huggingface.co/public-data/insightface/resolve/main/models/buffalo_l/genderage.onnx",
    "https://huggingface.co/lilacvit/insightface-buffalo-l/resolve/main/genderage.onnx",
]

# SCRFD-500M only (~2.5MB) — not full buffalo_s. Prefer tiny HF mirror; zip fallback extracts one file.
DET_500M_URLS = [
    "https://huggingface.co/RuteNL/SCRFD-face-detection-ONNX/resolve/main/500m.onnx",
]
BUFFALO_S_ZIP_URL = (
    "https://github.com/deepinsight/insightface/releases/download/model-zoo/buffalo_s.zip"
)

FACE_MODEL_NAMES = ("face.prototxt", "face.caffemodel")
OPENCV_AGE_NAMES = ("age.prototxt", "age.caffemodel")
GENDERAGE_NAME = "genderage.onnx"
DET_500M_NAME = "det_500m.onnx"


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


def download(name: str, dest: Path, urls: list[str] | None = None) -> None:
    min_size = MIN_MODEL_BYTES.get(name, 1000)
    if dest.exists() and dest.stat().st_size >= min_size and not _looks_like_html(dest):
        return
    if dest.exists():
        dest.unlink(missing_ok=True)

    url_list = urls if urls is not None else MODEL_URLS[name]
    dest.parent.mkdir(parents=True, exist_ok=True)
    last_err: Exception | None = None
    for url in url_list:
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


def ensure_face_models(d: Path) -> dict[str, Path]:
    paths: dict[str, Path] = {}
    for name in FACE_MODEL_NAMES:
        dest = d / name
        download(name, dest)
        paths[name] = dest
    return paths


def ensure_opencv_age_models(d: Path) -> dict[str, Path]:
    paths = ensure_face_models(d)
    for name in OPENCV_AGE_NAMES:
        dest = d / name
        download(name, dest)
        paths[name] = dest
    return paths


def ensure_genderage_model(d: Path) -> Path:
    dest = d / GENDERAGE_NAME
    download(GENDERAGE_NAME, dest, urls=GENDERAGE_URLS)
    return dest


def ensure_det_500m(d: Path) -> Path:
    """
    SCRFD-500M detector for the insightface engine (~2–2.5MB).
    Tries a small direct ONNX mirror first; falls back to extracting
    det_500m.onnx from the buffalo_s zip (keeps only that file).
    """
    dest = d / DET_500M_NAME
    min_size = MIN_MODEL_BYTES[DET_500M_NAME]
    if dest.exists() and dest.stat().st_size >= min_size and not _looks_like_html(dest):
        return dest

    try:
        download(DET_500M_NAME, dest, urls=DET_500M_URLS)
        return dest
    except Exception:
        pass

    import zipfile

    if dest.exists():
        dest.unlink(missing_ok=True)
    zip_path = d / "buffalo_s.zip"
    tmp = dest.with_suffix(dest.suffix + ".part")
    try:
        if zip_path.exists() and zip_path.stat().st_size < 50_000_000:
            zip_path.unlink(missing_ok=True)
        if not zip_path.exists():
            urllib.request.urlretrieve(BUFFALO_S_ZIP_URL, str(zip_path))
        with zipfile.ZipFile(zip_path, "r") as zf:
            member = None
            for name in zf.namelist():
                if name.replace("\\", "/").endswith("det_500m.onnx"):
                    member = name
                    break
            if member is None:
                raise RuntimeError("det_500m.onnx not found in buffalo_s.zip")
            with zf.open(member) as src, open(tmp, "wb") as out:
                out.write(src.read())
        if tmp.stat().st_size < min_size or _looks_like_html(tmp):
            raise RuntimeError(f"bad det_500m extract size={tmp.stat().st_size}")
        tmp.replace(dest)
        return dest
    finally:
        if tmp.exists():
            tmp.unlink(missing_ok=True)
        if zip_path.exists():
            zip_path.unlink(missing_ok=True)


def ensure_models(d: Path) -> dict[str, Path]:
    """OpenCV path: face + age caffe nets."""
    return ensure_opencv_age_models(d)


def load_image_bytes(data: bytes):
    import cv2
    import numpy as np

    arr = np.frombuffer(data, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise RuntimeError("cannot decode image")
    return img


def load_caffe(prototxt: Path, caffemodel: Path):
    import cv2

    if hasattr(cv2.dnn, "readNetFromCaffe"):
        return cv2.dnn.readNetFromCaffe(str(prototxt), str(caffemodel))
    return cv2.dnn.readNet(str(caffemodel), str(prototxt), "caffe")


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


def _distance2bbox(points, distance):
    import numpy as np

    x1 = points[:, 0] - distance[:, 0]
    y1 = points[:, 1] - distance[:, 1]
    x2 = points[:, 0] + distance[:, 2]
    y2 = points[:, 1] + distance[:, 3]
    return np.stack([x1, y1, x2, y2], axis=-1)


def _nms_xyxy(dets, thresh: float = 0.4):
    import numpy as np

    x1, y1, x2, y2, scores = dets[:, 0], dets[:, 1], dets[:, 2], dets[:, 3], dets[:, 4]
    areas = (x2 - x1 + 1) * (y2 - y1 + 1)
    order = scores.argsort()[::-1]
    keep = []
    while order.size > 0:
        i = int(order[0])
        keep.append(i)
        xx1 = np.maximum(x1[i], x1[order[1:]])
        yy1 = np.maximum(y1[i], y1[order[1:]])
        xx2 = np.minimum(x2[i], x2[order[1:]])
        yy2 = np.minimum(y2[i], y2[order[1:]])
        w = np.maximum(0.0, xx2 - xx1 + 1)
        h = np.maximum(0.0, yy2 - yy1 + 1)
        inter = w * h
        ovr = inter / (areas[i] + areas[order[1:]] - inter)
        order = order[np.where(ovr <= thresh)[0] + 1]
    return keep


def detect_faces_scrfd(
    session,
    img,
    conf_thresh: float = 0.5,
    input_size: tuple[int, int] = (640, 640),
):
    """
    SCRFD-500M / det_500m ONNX — InsightFace RetinaFace-compatible decode.
    Returns list of (x1, y1, x2, y2, conf) largest-first, same as detect_faces.
    """
    import cv2
    import numpy as np

    im_ratio = float(img.shape[0]) / img.shape[1]
    model_ratio = float(input_size[1]) / input_size[0]
    if im_ratio > model_ratio:
        new_height = input_size[1]
        new_width = int(new_height / im_ratio)
    else:
        new_width = input_size[0]
        new_height = int(new_width * im_ratio)
    det_scale = float(new_height) / img.shape[0]
    resized = cv2.resize(img, (new_width, new_height))
    det_img = np.zeros((input_size[1], input_size[0], 3), dtype=np.uint8)
    det_img[:new_height, :new_width, :] = resized
    blob = cv2.dnn.blobFromImage(
        det_img,
        1.0 / 128.0,
        input_size,
        (127.5, 127.5, 127.5),
        swapRB=True,
    )
    input_name = session.get_inputs()[0].name
    outs = session.run(None, {input_name: blob})
    fmc = 3
    strides = [8, 16, 32]
    scores_list = []
    bboxes_list = []
    input_height, input_width = input_size[1], input_size[0]
    for idx, stride in enumerate(strides):
        scores = np.asarray(outs[idx], dtype=np.float32).reshape(-1)
        bbox_preds = np.asarray(outs[idx + fmc], dtype=np.float32).reshape(-1, 4) * stride
        height = input_height // stride
        width = input_width // stride
        anchor_centers = np.stack(
            np.mgrid[:height, :width][::-1], axis=-1
        ).astype(np.float32)
        anchor_centers = (anchor_centers * stride).reshape((-1, 2))
        if anchor_centers.shape[0] * 2 == bbox_preds.shape[0]:
            anchor_centers = np.stack([anchor_centers] * 2, axis=1).reshape((-1, 2))
        pos = np.where(scores >= conf_thresh)[0]
        if pos.size == 0:
            continue
        scores_list.append(scores[pos])
        bboxes_list.append(_distance2bbox(anchor_centers, bbox_preds)[pos])
    if not scores_list:
        return []
    scores = np.concatenate(scores_list, axis=0)
    bboxes = np.vstack(bboxes_list) / det_scale
    order = scores.argsort()[::-1]
    pre = np.hstack((bboxes, scores.reshape(-1, 1))).astype(np.float32)[order]
    keep = _nms_xyxy(pre)
    det = pre[keep]
    boxes = []
    h, w = img.shape[:2]
    for row in det:
        x1, y1, x2, y2, conf = (float(v) for v in row)
        x1i, y1i = max(0, int(round(x1))), max(0, int(round(y1)))
        x2i, y2i = min(w - 1, int(round(x2))), min(h - 1, int(round(y2)))
        if x2i - x1i < 40 or y2i - y1i < 40:
            continue
        boxes.append((x1i, y1i, x2i, y2i, conf))
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


def classify_age(
    label: str,
    score: float,
    second_label: str,
    second_score: float,
    block_buckets: set[str],
    min_score: float,
    min_adult_score: float,
) -> tuple[bool, bool, str]:
    """
    Returns (blocked, uncertain, reason).
    - Clear child buckets with enough score → blocked (probable_minor)
    - Top teen (15-20) → uncertain (probable_uncertain)
    - Adult top but score < minAdultScore → uncertain
    - Adult top but second in child buckets with secondScore >= 0.15 → uncertain
    """
    # Clear children: hard-block when confident enough
    if label in CHILD_BUCKETS and (label in block_buckets or label in DEFAULT_BLOCK):
        if score >= min_score:
            return True, False, "probable_minor"

    if label == TEEN_BUCKET:
        return False, True, "probable_uncertain"

    if label in ADULT_BUCKETS:
        if score < min_adult_score:
            return False, True, "probable_uncertain"
        if second_label in CHILD_BUCKETS and second_score >= 0.15:
            return False, True, "probable_uncertain"
        return False, False, "adult_ok"

    # Legacy / unexpected: label in configured block list
    if label in block_buckets and score >= min_score:
        return True, False, "probable_minor"

    return False, False, "adult_ok"


def classify_years(
    age_years: float,
    min_adult_score: float,
) -> tuple[bool, bool, str, str, float]:
    """
    InsightFace continuous age → (blocked, uncertain, reason, ageLabel, score).
    soft_adult_max = 18 + (1 - min_adult_score) * 10  (e.g. 0.85 → ~19.5)
    """
    soft_adult_max = 18.0 + (1.0 - float(min_adult_score)) * 10.0
    age_label = f"{int(round(age_years))}y"
    # Synthetic UI confidence: distance from the 18y boundary, clamped
    dist = abs(float(age_years) - 18.0)
    score = float(min(0.99, max(0.05, dist / 20.0)))

    if age_years < 13.0:
        return True, False, "probable_minor", age_label, score
    if age_years < 18.0:
        return False, True, "probable_uncertain", age_label, score
    if age_years < soft_adult_max:
        return False, True, "probable_uncertain", age_label, score
    return False, False, "adult_ok", age_label, score


def crop_face(img, box, pad_ratio: float = 0.15):
    x1, y1, x2, y2 = box[:4]
    pad_w = int(pad_ratio * (x2 - x1))
    pad_h = int(pad_ratio * (y2 - y1))
    xa, ya = max(0, x1 - pad_w), max(0, y1 - pad_h)
    xb = min(img.shape[1] - 1, x2 + pad_w)
    yb = min(img.shape[0] - 1, y2 + pad_h)
    return img[ya:yb, xa:xb]


def crop_face_insightface(img, box, input_size: int = 96, box_scale: float = 1.5):
    """
    InsightFace Attribute.get() center warp into input_size square.

    Official Attribute:
      _scale = input_size / (max(w, h) * 1.5)
      face_align.transform(img, center, input_size, _scale, rotate=0)

    SCRFD boxes are tight; OpenCV SSD boxes are looser — always use 1.5 with SCRFD.
    """
    import cv2

    x1, y1, x2, y2 = [float(v) for v in box[:4]]
    bw, bh = (x2 - x1), (y2 - y1)
    center = ((x1 + x2) / 2.0, (y1 + y2) / 2.0)
    scale = float(input_size) / (max(bw, bh) * float(box_scale))
    M = cv2.getRotationMatrix2D(center, 0.0, scale)
    M[0, 2] += (input_size / 2.0) - center[0]
    M[1, 2] += (input_size / 2.0) - center[1]
    return cv2.warpAffine(
        img,
        M,
        (input_size, input_size),
        flags=cv2.INTER_LINEAR,
        borderValue=0.0,
    )


def predict_age_years_insightface(session, face_bgr_96) -> float:
    """
    buffalo_l genderage (InsightFace Attribute):
      blobFromImage(..., 1/std, mean, swapRB=True) with mean=0, std=1
      (model has built-in _minus/_mul / bn-style nodes).
      age_years = pred[2] * 100
    """
    import cv2
    import numpy as np

    input_size = (96, 96)
    # mean=0, std=1 → scalefactor 1.0, mean (0,0,0), swapRB=True
    blob = cv2.dnn.blobFromImage(
        face_bgr_96,
        1.0,
        input_size,
        (0.0, 0.0, 0.0),
        swapRB=True,
    )
    input_name = session.get_inputs()[0].name
    outs = session.run(None, {input_name: blob})
    out = np.asarray(outs[0], dtype=float)
    flat = out.reshape(-1)
    if flat.size >= 3:
        # InsightFace genderage: pred[2] is age/100
        return float(flat[2]) * 100.0
    if flat.size == 1:
        v = float(flat[0])
        return v * 100.0 if abs(v) < 2.0 else v
    raise RuntimeError(f"unexpected genderage output shape: {out.shape}")


def analyze_opencv(
    img_bytes: bytes,
    block_buckets: set[str],
    face_thresh: float,
    min_score: float = 0.55,
    min_adult_score: float = 0.85,
) -> dict:
    d = models_dir()
    paths = ensure_opencv_age_models(d)

    face_net = load_caffe(paths["face.prototxt"], paths["face.caffemodel"])
    age_net = load_caffe(paths["age.prototxt"], paths["age.caffemodel"])

    img = load_image_bytes(img_bytes)
    faces = detect_faces(face_net, img, face_thresh)
    if not faces:
        # No detectable face — block uploads for 18+ refs (minors can slip through otherwise)
        return {
            "ok": True,
            "blocked": True,
            "uncertain": False,
            "faces": 0,
            "reason": "no_face",
            "ageLabel": None,
            "score": None,
            "ageYears": None,
            "engine": "opencv-dnn-age",
            "models": {k: paths[k].stat().st_size for k in paths},
        }

    # Only the largest face (reference selfie). Avoid false boxes aged as kids.
    faces = faces[:1]

    x1, y1, x2, y2, fconf = faces[0]
    crop = crop_face(img, (x1, y1, x2, y2), pad_ratio=0.15)
    label, score, idx, second_label, second_score = predict_age(age_net, crop)
    blocked, uncertain, reason = classify_age(
        label,
        score,
        second_label,
        second_score,
        block_buckets,
        min_score,
        min_adult_score,
    )
    item = {
        "ageLabel": label,
        "score": round(score, 4),
        "bucketIndex": idx,
        "secondLabel": second_label,
        "secondScore": round(second_score, 4),
        "faceConfidence": round(float(fconf), 4),
        "blocked": blocked,
        "uncertain": uncertain,
    }
    return {
        "ok": True,
        "blocked": blocked,
        "uncertain": uncertain,
        "faces": 1,
        "reason": reason,
        "ageLabel": label,
        "score": round(score, 4),
        "secondLabel": second_label,
        "secondScore": round(second_score, 4),
        "bucketIndex": idx,
        "ageYears": None,
        "engine": "opencv-dnn-age",
        "face": item,
        "models": {k: paths[k].stat().st_size for k in paths},
    }


def analyze_insightface(
    img_bytes: bytes,
    face_thresh: float,
    min_adult_score: float = 0.85,
) -> dict:
    import onnxruntime as ort

    d = models_dir()
    # genderage + SCRFD det; OpenCV SSD face model only as detector fallback.
    face_paths = ensure_face_models(d)
    genderage_path = ensure_genderage_model(d)
    det_path = ensure_det_500m(d)
    paths = {
        **{k: face_paths[k] for k in FACE_MODEL_NAMES},
        GENDERAGE_NAME: genderage_path,
        DET_500M_NAME: det_path,
    }

    det_session = ort.InferenceSession(
        str(det_path),
        providers=["CPUExecutionProvider"],
    )
    session = ort.InferenceSession(
        str(genderage_path),
        providers=["CPUExecutionProvider"],
    )

    img = load_image_bytes(img_bytes)
    # SCRFD boxes match Attribute training better than OpenCV SSD.
    scrfd_thresh = min(0.5, float(face_thresh))
    faces = detect_faces_scrfd(det_session, img, conf_thresh=scrfd_thresh)
    if not faces:
        # Fallback: OpenCV SSD if SCRFD misses
        face_net = load_caffe(face_paths["face.prototxt"], face_paths["face.caffemodel"])
        faces = detect_faces(face_net, img, face_thresh)
    if not faces:
        return {
            "ok": True,
            "blocked": True,
            "uncertain": False,
            "faces": 0,
            "reason": "no_face",
            "ageLabel": None,
            "score": None,
            "ageYears": None,
            "engine": "insightface-genderage",
            "models": {k: paths[k].stat().st_size for k in paths},
        }

    faces = faces[:1]
    x1, y1, x2, y2, fconf = faces[0]
    # Official Attribute pad: side = max(w,h)*1.5
    face96 = crop_face_insightface(
        img, (x1, y1, x2, y2), input_size=96, box_scale=1.5
    )
    age_years = predict_age_years_insightface(session, face96)

    blocked, uncertain, reason, age_label, score = classify_years(
        age_years, min_adult_score
    )
    item = {
        "ageLabel": age_label,
        "ageYears": round(age_years, 2),
        "score": round(score, 4),
        "faceConfidence": round(float(fconf), 4),
        "blocked": blocked,
        "uncertain": uncertain,
    }
    return {
        "ok": True,
        "blocked": blocked,
        "uncertain": uncertain,
        "faces": 1,
        "reason": reason,
        "ageLabel": age_label,
        "score": round(score, 4),
        "ageYears": round(age_years, 2),
        "engine": "insightface-genderage",
        "face": item,
        "models": {k: paths[k].stat().st_size for k in paths},
    }


def normalize_engine(raw: str | None) -> str:
    s = (raw or "opencv").strip().lower()
    if s in ("insightface", "onnx"):
        return "insightface"
    return "opencv"


def analyze(
    img_bytes: bytes,
    block_buckets: set[str],
    face_thresh: float,
    min_score: float = 0.55,
    min_adult_score: float = 0.85,
    engine: str = "opencv",
) -> dict:
    eng = normalize_engine(engine)
    if eng == "insightface":
        return analyze_insightface(
            img_bytes,
            face_thresh=face_thresh,
            min_adult_score=min_adult_score,
        )
    return analyze_opencv(
        img_bytes,
        block_buckets=block_buckets,
        face_thresh=face_thresh,
        min_score=min_score,
        min_adult_score=min_adult_score,
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("path", nargs="?", help="image path")
    parser.add_argument("--stdin", action="store_true")
    parser.add_argument(
        "--engine",
        default="opencv",
        choices=["opencv", "insightface", "onnx"],
        help="age model: opencv (Gil Levi buckets) or insightface/onnx (genderage years)",
    )
    parser.add_argument(
        "--block",
        default=",".join(sorted(DEFAULT_BLOCK)),
        help="comma-separated age buckets to hard-block (children; opencv only)",
    )
    parser.add_argument("--face-thresh", type=float, default=0.6)
    parser.add_argument("--min-score", type=float, default=0.55)
    parser.add_argument("--min-adult-score", type=float, default=0.85)
    parser.add_argument("--force-redownload", action="store_true")
    args = parser.parse_args()

    engine = normalize_engine(args.engine)
    engine_json = (
        "insightface-genderage" if engine == "insightface" else "opencv-dnn-age"
    )

    if args.force_redownload:
        d = models_dir()
        for name in list(MODEL_URLS.keys()) + [GENDERAGE_NAME, DET_500M_NAME]:
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
        result = analyze(
            data,
            block,
            args.face_thresh,
            args.min_score,
            args.min_adult_score,
            engine=engine,
        )
    except Exception as e:
        result = {
            "ok": False,
            "blocked": False,
            "uncertain": False,
            "error": str(e),
            "engine": engine_json,
        }
        print(json.dumps(result, ensure_ascii=False))
        return 2

    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
