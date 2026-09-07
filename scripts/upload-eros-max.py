#!/usr/bin/env python3
"""Upload H3 Eros Max with auto-reconnect resume until complete."""
from __future__ import annotations

import json
import time
from pathlib import Path

import paramiko

ROOT = Path(__file__).resolve().parents[1]
CFG = json.loads((ROOT / "infra" / "metalnode.local.json").read_text(encoding="utf-8"))
LOCAL = Path(r"C:\Users\Олег\Downloads\h3ErosMax_beta3.safetensors")
REMOTE_DIR = "/work/ComfyUI/models/diffusion_models"
REMOTE = f"{REMOTE_DIR}/h3ErosMax_beta3.safetensors"
CHUNK = 8 * 1024 * 1024  # 8 MiB — smaller chunks survive flaky SSH better


def connect() -> paramiko.SSHClient:
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    pkey = paramiko.Ed25519Key.from_private_key_file(str(CFG["sshKeyPath"]))
    c.connect(
        CFG["host"],
        port=int(CFG["sshPort"]),
        username=str(CFG.get("sshUser") or "root"),
        pkey=pkey,
        timeout=120,
        banner_timeout=120,
        auth_timeout=120,
        allow_agent=False,
        look_for_keys=False,
        compress=False,
    )
    t = c.get_transport()
    if t:
        t.set_keepalive(10)
        try:
            t.window_size = 2 * 1024 * 1024
            t.packetizer.REKEY_BYTES = pow(2, 40)
            t.packetizer.REKEY_PACKETS = pow(2, 40)
        except Exception:
            pass
    return c


def remote_size(sftp: paramiko.SFTPClient, path: str) -> int:
    try:
        return int(sftp.stat(path).st_size)
    except FileNotFoundError:
        return 0


def upload_once(local_size: int) -> int:
    """Returns bytes on remote after this attempt."""
    c = connect()
    try:
        c.exec_command(f"mkdir -p {REMOTE_DIR}").channel.recv_exit_status()
        sftp = c.open_sftp()
        try:
            done = remote_size(sftp, REMOTE)
            if done == local_size:
                print(f"COMPLETE {REMOTE} ({done})", flush=True)
                return done
            if done > local_size:
                print(f"TRUNCATE remote {done} > local {local_size}", flush=True)
                sftp.remove(REMOTE)
                done = 0

            mode = "ab" if done else "wb"
            print(f"RESUME from {done}/{local_size}", flush=True)
            t0 = time.time()
            last = t0
            start = done
            with LOCAL.open("rb") as src, sftp.file(REMOTE, mode) as dst:
                if done:
                    src.seek(done)
                # Prefer large pipe buffer for writes
                try:
                    dst.set_pipelined(True)
                except Exception:
                    pass
                sent = done
                while True:
                    buf = src.read(CHUNK)
                    if not buf:
                        break
                    dst.write(buf)
                    sent += len(buf)
                    now = time.time()
                    if now - last >= 8 or sent == local_size:
                        pct = 100.0 * sent / local_size
                        mbps = (sent - start) / max(now - t0, 1) / (1024 * 1024)
                        print(f"  {sent}/{local_size} ({pct:.2f}%) ~{mbps:.2f} MB/s", flush=True)
                        last = now
                dst.flush()
            return remote_size(sftp, REMOTE)
        finally:
            sftp.close()
    finally:
        c.close()


def main() -> int:
    if not LOCAL.exists():
        print(f"MISSING {LOCAL}", flush=True)
        return 1
    local_size = LOCAL.stat().st_size
    print(f"LOCAL size={local_size}", flush=True)

    attempt = 0
    while True:
        attempt += 1
        try:
            size = upload_once(local_size)
            if size == local_size:
                print("DONE", flush=True)
                return 0
            print(f"PARTIAL {size}/{local_size} — reconnect attempt {attempt}", flush=True)
        except Exception as e:
            print(f"ERR attempt {attempt}: {type(e).__name__}: {e}", flush=True)
        time.sleep(3)


if __name__ == "__main__":
    raise SystemExit(main())
