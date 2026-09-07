import paramiko
import sys

HOST = "77.94.203.13"
PORT = 22024
KEY = r"C:\Users\Олег\Downloads\metalnode_id_ed25519 (4).txt"
USER = "root"
# NOTE: shared constants for other _metalnode_h3cn_*.py scripts in this session

CMDS = [
    "ls /work/ComfyUI/custom_nodes/ | sort",
    "ls /work/ComfyUI/models/controlnet/ 2>&1",
    "ls /work/ComfyUI/models/clip_vision/ 2>&1",
    "ls /work/ComfyUI/models/ipadapter/ 2>&1",
    "ls /work/ComfyUI/models/style_models/ 2>&1",
    "ls /work/ComfyUI/models/ultralytics/bbox/ 2>&1",
    "ls /work/ComfyUI/models/sams/ 2>&1",
    "ls /work/ComfyUI/models/diffusion_models/ 2>&1 | grep -i flux",
    "find /work/ComfyUI/custom_nodes -maxdepth 1 -iname '*controlnet*'",
    "find /work/ComfyUI/custom_nodes -maxdepth 1 -iname '*ipadapter*'",
]


def main():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        pkey = paramiko.Ed25519Key.from_private_key_file(KEY)
        client.connect(HOST, port=PORT, username=USER, pkey=pkey, timeout=20, allow_agent=False, look_for_keys=False)
    except Exception as e:
        print(f"CONNECT FAILED on port {PORT}: {e}")
        sys.exit(1)

    for cmd in CMDS:
        print(f"\n=== {cmd} ===")
        stdin, stdout, stderr = client.exec_command(cmd, timeout=20)
        out = stdout.read().decode(errors="replace")
        err = stderr.read().decode(errors="replace")
        print(out.strip() or "(empty)")
        if err.strip():
            print("STDERR:", err.strip())

    client.close()


if __name__ == "__main__":
    main()
