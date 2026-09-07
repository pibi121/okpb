#!/usr/bin/env python3
"""Compare audio energy of BEFORE (no bgm, original stitched clip) vs AFTER (patched mixer output) to confirm BGM was actually mixed in."""
from pathlib import Path
import sys
import paramiko

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
KEY = Path(r"C:\Users\Олег\Downloads\metalnode_id_ed25519 (5).txt")

REMOTE = r'''
/work/ai/venv/bin/python - <<'PY'
import torchaudio, torch

def load_wave(path_mp4_or_audio, is_video):
    if is_video:
        wav, sr = torchaudio.load(path_mp4_or_audio)
    else:
        wav, sr = torchaudio.load(path_mp4_or_audio)
    return wav, sr

orig_video = "/work/ComfyUI/output/Stitch/autoedit_00002-audio.mp4"
mixed_video = "/work/ComfyUI/output/Final/bgm_patch_verify_00001-audio.mp4"
bgm_only = "/work/ComfyUI/output/audio/bgm_sensual_00003.flac"

for label, path in [("ORIGINAL (no bgm)", orig_video), ("MIXED (patched)", mixed_video), ("BGM SOURCE", bgm_only)]:
    try:
        wav, sr = torchaudio.load(path)
        rms = wav.pow(2).mean().sqrt().item()
        peak = wav.abs().max().item()
        print(f"{label}: sr={sr}, shape={tuple(wav.shape)}, dur={wav.shape[1]/sr:.2f}s, RMS={rms:.5f}, peak={peak:.5f}")
    except Exception as e:
        print(f"{label}: ERROR {e}")

# Correlate a middle segment: mixed - original should resemble bgm characteristics (non-zero diff)
try:
    w_orig, sr1 = torchaudio.load(orig_video)
    w_mixed, sr2 = torchaudio.load(mixed_video)
    n = min(w_orig.shape[1], w_mixed.shape[1])
    diff = (w_mixed[:, :n] - w_orig[:, :n] if w_orig.shape[0]==w_mixed.shape[0] else w_mixed[:1,:n]-w_orig[:1,:n])
    print(f"DIFF (mixed-original) RMS={diff.pow(2).mean().sqrt().item():.5f}, peak={diff.abs().max().item():.5f}")
except Exception as e:
    print("DIFF calc error:", e)
PY
'''

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
pkey = paramiko.Ed25519Key.from_private_key_file(str(KEY))
c.connect("77.94.203.13", port=22022, username="root", pkey=pkey, timeout=30, allow_agent=False, look_for_keys=False)
stdin, stdout, stderr = c.exec_command(REMOTE, timeout=60)
print(stdout.read().decode(errors="replace"))
err = stderr.read().decode(errors="replace")
if err.strip():
    print("STDERR:", err[-2000:])
c.close()
