#!/usr/bin/env python3
"""Forward extra local ports to fleet Metalnode Comfy instances.

Env METALNODE_FLEET_JSON — JSON array:
  [{"localPort":8189,"sshPort":22031,"keyPath":"/tmp/metalnode_key_bmserv4","host":"...","sshUser":"root"}, ...]

Or defaults for bmserv4/bmserv1 when key files exist.
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

LOCAL_HOST = "127.0.0.1"
REMOTE_HOST = "127.0.0.1"
REMOTE_PORT = 8188


def log(msg: str) -> None:
    print(f"[paramiko-fleet] {msg}", flush=True)


def default_fleet() -> list[dict]:
    host = (os.environ.get("METALNODE_HOST") or "77.94.203.13").strip()
    user = (os.environ.get("METALNODE_SSH_USER") or "root").strip()
    return [
        {
            "name": "bmserv4",
            "localPort": 8189,
            "sshPort": 22031,
            "keyPath": "/tmp/metalnode_key_bmserv4",
            "host": host,
            "sshUser": user,
        },
        {
            "name": "bmserv1",
            "localPort": 8190,
            "sshPort": 22022,
            "keyPath": "/tmp/metalnode_key_bmserv1",
            "host": host,
            "sshUser": user,
        },
    ]


def load_fleet() -> list[dict]:
    raw = (os.environ.get("METALNODE_FLEET_JSON") or "").strip()
    if raw:
        try:
            data = json.loads(raw)
            if isinstance(data, list) and data:
                return data
        except Exception as e:
            log(f"bad METALNODE_FLEET_JSON: {e}")
    return default_fleet()


def connect(cfg: dict) -> paramiko.SSHClient:
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    pkey = paramiko.Ed25519Key.from_private_key_file(str(cfg["keyPath"]))
    c.connect(
        str(cfg["host"]),
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
    name = cfg.get("name") or f"port{cfg.get('localPort')}"
    client_ssh = connect(cfg)
    transport = client_ssh.get_transport()
    if not transport or not transport.is_active():
        client_ssh.close()
        raise RuntimeError(f"{name}: transport inactive")

    ka = transport.open_session()
    ka.exec_command("while true; do echo k; sleep 2; done")
    threading.Thread(target=drain_keepalive, args=(ka,), daemon=True).start()

    local_port = int(cfg["localPort"])
    srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    srv.bind((LOCAL_HOST, local_port))
    srv.listen(64)
    srv.settimeout(1.0)
    log(
        f"{name}: listening {LOCAL_HOST}:{local_port} -> "
        f"{cfg['host']}:{cfg['sshPort']} -> {REMOTE_HOST}:{REMOTE_PORT}"
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
        log(f"{name}: transport died")
    finally:
        try:
            srv.close()
        except Exception:
            pass
        try:
            client_ssh.close()
        except Exception:
            pass


def run_tunnel_loop(cfg: dict) -> None:
    name = cfg.get("name") or str(cfg.get("localPort"))
    key = Path(str(cfg.get("keyPath") or ""))
    if not key.exists():
        log(f"{name}: skip — missing key {key}")
        return
    backoff = 4.0
    while True:
        try:
            serve_once(cfg)
            backoff = 4.0
        except Exception as e:
            log(f"{name}: ERR {e}")
            traceback.print_exc()
            if "can't start new thread" in str(e):
                backoff = min(120.0, max(backoff, 30.0) * 1.5)
            else:
                backoff = min(60.0, backoff * 1.4)
        time.sleep(backoff)
        log(f"{name}: reconnect")


def main() -> int:
    fleet = load_fleet()
    threads: list[threading.Thread] = []
    for cfg in fleet:
        key = Path(str(cfg.get("keyPath") or ""))
        if not key.exists():
            log(f"skip {cfg.get('name')}: no key at {key}")
            continue
        t = threading.Thread(target=run_tunnel_loop, args=(cfg,), daemon=True)
        t.start()
        threads.append(t)
    if not threads:
        log("no fleet tunnels to start")
        return 1
    log(f"started {len(threads)} fleet tunnel(s)")
    while True:
        alive = sum(1 for t in threads if t.is_alive())
        if alive == 0:
            log("all fleet tunnels exited")
            return 1
        time.sleep(5)


if __name__ == "__main__":
    try:
        sys.exit(main() or 0)
    except KeyboardInterrupt:
        sys.exit(0)
