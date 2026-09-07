#!/usr/bin/env python3
import os
import paramiko

PASSWORD = os.environ["GPUGO_PASS"]


def main():
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(
        "95.165.71.177",
        port=42010,
        username="root",
        password=PASSWORD,
        timeout=60,
        allow_agent=False,
        look_for_keys=False,
    )

    remote = r'''
set -e
echo "=== logs ==="
ls /var/log/supervisor/ || true
find /opt/ComfyUI -maxdepth 2 -name "*.log" 2>/dev/null | head
# supervisor stdout often in conf
grep -r stdout /etc/supervisor* 2>/dev/null | head -20 || true
cat /etc/supervisor/conf.d/*comfy* 2>/dev/null || cat /etc/supervisord.conf 2>/dev/null | head -80

echo "=== seedvr import ==="
cd /opt/ComfyUI
.venv/bin/python << 'PY'
import sys, traceback
sys.path.insert(0, "/workspace/custom_nodes/ComfyUI-SeedVR2_VideoUpscaler")
try:
    import __init__ as m
    print("init", m)
except Exception:
    traceback.print_exc()
try:
    from src.interfaces import comfy_entrypoint, SeedVR2Extension
    print("entrypoint", comfy_entrypoint, SeedVR2Extension)
except Exception:
    traceback.print_exc()
PY

echo "=== WAS import ==="
.venv/bin/python << 'PY'
import sys, traceback
sys.path.insert(0, "/workspace/custom_nodes/was-node-suite-comfyui")
try:
    import WAS_Node_Suite
    print("WAS ok", hasattr(WAS_Node_Suite, "NODE_CLASS_MAPPINGS"))
    m = getattr(WAS_Node_Suite, "NODE_CLASS_MAPPINGS", {})
    for k in ["Image Lucy Sharpen", "Image Bloom Filter"]:
        print(k, k in m)
except Exception:
    traceback.print_exc()
PY

echo "=== comfy load custom nodes dry ==="
# look for recent process output
ps aux | grep -i comfy | grep -v grep | head
# try reading from /proc
PID=$(supervisorctl pid comfyui)
echo PID=$PID
ls -l /proc/$PID/fd 2>/dev/null | head
# dump last lines from any redirected log via supervisor
python3 - << 'PY'
import os, glob
for p in glob.glob("/var/log/supervisor/*") + glob.glob("/tmp/*") + glob.glob("/opt/ComfyUI/user/**/*.log", recursive=True):
    if os.path.isfile(p) and os.path.getsize(p) < 50_000_000:
        name=os.path.basename(p).lower()
        if any(x in name for x in ["comfy","supervis","err","out"]):
            print("FILE", p, os.path.getsize(p))
PY
'''
    stdin, stdout, stderr = c.exec_command(remote, timeout=180)
    out = stdout.read().decode(errors="replace")
    err = stderr.read().decode(errors="replace")
    # write to utf-8 file to avoid console encoding issues
    out_path = os.path.join(os.path.dirname(__file__), "_diag_out.txt")
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(out)
        if err:
            f.write("\n===STDERR===\n")
            f.write(err)
    print("wrote", out_path, "bytes", os.path.getsize(out_path))
    c.close()


if __name__ == "__main__":
    main()
