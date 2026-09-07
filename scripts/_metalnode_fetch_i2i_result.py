#!/usr/bin/env python3
"""Download the i2i test result + source reference + preview crop for visual comparison."""
from pathlib import Path
import sys
import paramiko

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

HOST = "77.94.203.13"
PORT = 22024
KEY = Path(r"C:\Users\Олег\Downloads\metalnode_id_ed25519 (4).txt")
USER = "root"

FILES = [
    ("/work/ComfyUI/output/Flux2_I2I_TEST_00001_.png", r"C:\Users\Олег\Desktop\Проект Х\peachbitch\workflows\_test_i2i_result.png"),
    ("/work/ComfyUI/input/(m=eaAaGwObaaaa)(mh=_YY1wUNGNfw2ea1L)4.jpg", r"C:\Users\Олег\Desktop\Проект Х\peachbitch\workflows\_test_i2i_reference.jpg"),
    ("/work/ComfyUI/temp/ComfyUI_temp_pqgym_00001_.png", r"C:\Users\Олег\Desktop\Проект Х\peachbitch\workflows\_test_i2i_reference_crop.png"),
]


def main():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    pkey = paramiko.Ed25519Key.from_private_key_file(str(KEY))
    client.connect(HOST, port=PORT, username=USER, pkey=pkey, timeout=30, allow_agent=False, look_for_keys=False)
    sftp = client.open_sftp()
    for remote, local in FILES:
        try:
            sftp.get(remote, local)
            print("OK", remote, "->", local)
        except Exception as e:
            print("FAIL", remote, e)
    sftp.close()
    client.close()


if __name__ == "__main__":
    main()
