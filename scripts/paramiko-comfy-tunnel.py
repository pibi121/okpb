#!/usr/bin/env python3
"""Forward 127.0.0.1:8188 to Metalnode Comfy. Windows OpenSSH -L dies with exit -1.

Config:
  1) Env (Railway): METALNODE_HOST, METALNODE_SSH_PORT, METALNODE_SSH_USER,
     METALNODE_SSH_KEY_PATH (or METALNODE_SSH_KEY written to that path)
  2) Fallback: infra/metalnode.local.json
"""
from __future__ import annotations

import json
import os
import socket
import sys
import threading
import time
import traceback
from pathlib import Path

import paramiko

ROOT = Path(__file__).resolve().parents[1]
CFG_PATH = ROOT / "infra" / "metalnode.local.json"
LOCAL_HOST = "127.0.0.1"
LOCAL_PORT = int(os.environ.get("COMFY_LOCAL_PORT") or "8188")
REMOTE_HOST = "127.0.0.1"
REMOTE_PORT = 8188


def log(msg: str) -> None:
    print(f"[paramiko-tunnel] {msg}", flush=True)


def load_cfg() -> dict:
    host = (os.environ.get("METALNODE_HOST") or "").strip()
    key_path = (os.environ.get("METALNODE_SSH_KEY_PATH") or "").strip()
    if host and key_path:
        return {
            "host": host,
            "sshPort": int(os.environ.get("METALNODE_SSH_PORT") or "22034"),
            "sshUser": (os.environ.get("METALNODE_SSH_USER") or "root").strip(),
            "sshKeyPath": key_path,
        }
    return json.loads(CFG_PATH.read_text(encoding="utf-8"))


def connect(cfg: dict) -> paramiko.SSHClient:
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    pkey = paramiko.Ed25519Key.from_private_key_file(str(cfg["sshKeyPath"]))
    c.connect(
        cfg["host"],
        port=int(cfg["sshPort"]),
        username=str(cfg.get("sshUser") or "root"),
        pkey=pkey,
        timeout=60,
        banner_timeout=60,
        auth_timeout=60,
        allow_agent=False,
        look_for_keys=False,
        compress=False,
    )
    t = c.get_transport()
    if t:
        t.set_keepalive(15)
    return c


def pipe(src, dst) -> None:
    try:
        while True:
            data = src.recv(32768)
            if not data:
                break
            dst.sendall(data)
    except Exception:
        pass
    for sock in (src, dst):
        try:
            sock.close()
        except Exception:
            pass


def drain_keepalive(chan: paramiko.Channel) -> None:
    try:
        while True:
            if chan.recv_ready():
                chan.recv(4096)
            elif chan.exit_status_ready():
                break
            else:
                time.sleep(0.5)
    except Exception:
        pass


def handle_client(client: socket.socket, transport: paramiko.Transport) -> None:
    try:
        chan = transport.open_channel(
            "direct-tcpip",
            (REMOTE_HOST, REMOTE_PORT),
            client.getpeername(),
        )
    except Exception as e:
        log(f"open_channel fail: {e}")
        client.close()
        return
    threading.Thread(target=pipe, args=(client, chan), daemon=True).start()
    threading.Thread(target=pipe, args=(chan, client), daemon=True).start()


def serve_once(cfg: dict) -> None:
    client_ssh = connect(cfg)
    transport = client_ssh.get_transport()
    if not transport or not transport.is_active():
        client_ssh.close()
        raise RuntimeError("transport inactive")

    ka = transport.open_session()
    ka.exec_command("while true; do echo k; sleep 2; done")
    threading.Thread(target=drain_keepalive, args=(ka,), daemon=True).start()

    srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    srv.bind((LOCAL_HOST, LOCAL_PORT))
    srv.listen(64)
    srv.settimeout(1.0)
    log(
        f"listening {LOCAL_HOST}:{LOCAL_PORT} -> {cfg['host']}:{cfg['sshPort']} "
        f"-> {REMOTE_HOST}:{REMOTE_PORT}"
    )
    try:
        while transport.is_active():
            try:
                client, _addr = srv.accept()
            except socket.timeout:
                continue
            threading.Thread(
                target=handle_client, args=(client, transport), daemon=True
            ).start()
        log("transport died")
    finally:
        try:
            srv.close()
        except Exception:
            pass
        try:
            client_ssh.close()
        except Exception:
            pass


def main() -> int:
    try:
        cfg = load_cfg()
    except Exception as e:
        log(f"config error: {e}")
        if not CFG_PATH.exists():
            log(f"missing {CFG_PATH}")
        return 1
    if not Path(cfg["sshKeyPath"]).exists():
        log(f"missing key {cfg['sshKeyPath']}")
        return 1
    while True:
        try:
            serve_once(cfg)
        except Exception as e:
            log(f"ERR {e}")
            traceback.print_exc()
        time.sleep(4)
        log("reconnect")


if __name__ == "__main__":
    try:
        sys.exit(main() or 0)
    except KeyboardInterrupt:
        sys.exit(0)
