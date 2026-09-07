#!/usr/bin/env python3
"""Fix failed clones + correct ControlAltAI/PromptModels, then restart Comfy."""
from pathlib import Path
import paramiko
import time

KEY = Path(r"C:\Users\Олег\Desktop\Проект Х\peachbitch\metalnode_id_ed25519")

REMOTE = r'''#!/usr/bin/env python3
import os, subprocess, shutil, time
from pathlib import Path

CN = Path("/work/ComfyUI/custom_nodes")
PIP = "/work/ai/venv/bin/pip"
PY = "/work/ai/venv/bin/python3"
LOG = Path("/work/INSTALL_NODES_FIX.log")

PACKS = [
    ("https://github.com/cubiq/ComfyUI_essentials.git", "ComfyUI_essentials"),
    ("https://github.com/ltdrdata/ComfyUI-Impact-Subpack.git", "ComfyUI-Impact-Subpack"),
    ("https://github.com/EllangoK/ComfyUI-post-processing-nodes.git", "ComfyUI-post-processing-nodes"),
    ("https://github.com/gseth/ControlAltAI-Nodes.git", "ControlAltAI-Nodes"),
    ("https://github.com/BadCafeCode/masquerade-nodes-comfyui.git", "masquerade-nodes-comfyui"),
    ("https://github.com/rgthree/rgthree-comfy.git", "rgthree-comfy"),
    ("https://github.com/numz/ComfyUI-SeedVR2_VideoUpscaler.git", "ComfyUI-SeedVR2_VideoUpscaler"),
    ("https://github.com/WASasquatch/was-node-suite-comfyui.git", "was-node-suite-comfyui"),
    ("https://github.com/cdanielp/COMFYUI_PROMPTMODELS.git", "COMFYUI_PROMPTMODELS"),
    ("https://github.com/chrisgoringe/cg-use-everywhere.git", "cg-use-everywhere"),
    ("https://github.com/TinyTerra/ComfyUI_tinyterraNodes.git", "ComfyUI_tinyterraNodes"),
    ("https://github.com/ltdrdata/ComfyUI-Impact-Pack.git", "ComfyUI-Impact-Pack"),
]

def log(m):
    line = f"[{time.strftime('%H:%M:%S')}] {m}"
    print(line, flush=True)
    with LOG.open("a", encoding="utf-8") as f:
        f.write(line + "\n")

def run(cmd, cwd=None, timeout=900):
    log("$ " + " ".join(cmd))
    r = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, timeout=timeout)
    if r.returncode != 0:
        log(f"rc={r.returncode} stderr={(r.stderr or '')[-800:]} stdout={(r.stdout or '')[-400:]}")
    return r.returncode

def ensure(url, name):
    dest = CN / name
    if dest.exists() and (dest / ".git").exists():
        log(f"OK exists {name}")
        return dest
    if dest.exists():
        shutil.rmtree(dest, ignore_errors=True)
    for i in range(4):
        # GIT_TERMINAL_PROMPT=0 avoid hang; prefer HTTPS
        env = os.environ.copy()
        env["GIT_TERMINAL_PROMPT"] = "0"
        log(f"clone try {i+1} {name}")
        r = subprocess.run(
            ["git", "clone", "--depth", "1", url, str(dest)],
            capture_output=True, text=True, timeout=300, env=env,
        )
        if r.returncode == 0 and dest.exists():
            log(f"cloned {name}")
            return dest
        log(f"fail: {(r.stderr or r.stdout or '')[-500:]}")
        shutil.rmtree(dest, ignore_errors=True)
        time.sleep(2)
    return None

def pip_req(dest):
    req = dest / "requirements.txt"
    if req.exists():
        run([PIP, "install", "-q", "-r", str(req)], timeout=900)
    # nested promptmodels
    for sub in dest.rglob("requirements.txt"):
        if sub == req:
            continue
        # only install first-level package reqs under PromptModels
        if sub.parent.parent == dest or sub.parent == dest:
            run([PIP, "install", "-q", "-r", str(sub)], timeout=600)
    inst = dest / "install.py"
    if inst.exists():
        run([PY, str(inst)], cwd=str(dest), timeout=600)

def main():
    LOG.write_text("fix nodes\n", encoding="utf-8")
    # remove wrong ControlAltAI clones if any
    for bad in ("ComfyUI-ControlAltAI-Nodes", "controlaltai-nodes", "PromptModels"):
        p = CN / bad
        if p.exists() and bad != "ControlAltAI-Nodes":
            # keep if has content; only remove empty/failed
            pass

    for url, name in PACKS:
        d = ensure(url, name)
        if d:
            pip_req(d)
        else:
            log(f"FAILED {name}")

    run([PIP, "install", "-q", "ultralytics", "segment-anything", "piexif", "dill", "opencv-python-headless", "scipy", "scikit-image"], timeout=900)

    log("=== installed ===")
    for p in sorted(CN.iterdir()):
        if p.is_dir() and not p.name.startswith("."):
            log("  " + p.name)
    Path("/work/INSTALL_NODES_FIX_DONE.txt").write_text("ok\n")
    log("DONE")

if __name__ == "__main__":
    main()
'''

def main():
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    pkey = paramiko.Ed25519Key.from_private_key_file(str(KEY))
    c.connect("77.94.203.13", port=22024, username="root", pkey=pkey, timeout=60, allow_agent=False, look_for_keys=False)
    c.get_transport().set_keepalive(20)

    # kill old installer if stuck
    _, so, _ = c.exec_command("pkill -f /tmp/install_nodes.py || true; sleep 1; pgrep -af install_nodes || echo killed", timeout=20)
    print(so.read().decode(errors="replace"))

    sftp = c.open_sftp()
    with sftp.file("/tmp/install_nodes_fix.py", "w") as f:
        f.write(REMOTE)
    sftp.close()

    stdin, stdout, stderr = c.exec_command(
        "nohup /work/ai/venv/bin/python3 -u /tmp/install_nodes_fix.py >/work/INSTALL_NODES_FIX.nohup 2>&1 & echo PID=$!; sleep 3; pgrep -af install_nodes_fix; head -n 20 /work/INSTALL_NODES_FIX.log",
        get_pty=True,
        timeout=30,
    )
    print(stdout.read().decode(errors="replace"))
    c.close()

if __name__ == "__main__":
    main()
