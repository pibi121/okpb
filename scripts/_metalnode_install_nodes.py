#!/usr/bin/env python3
"""Install custom nodes needed for Z-Image ALLinONE v2 on Metalnode."""
from __future__ import annotations

import time
from pathlib import Path

import paramiko

KEY = Path(r"C:\Users\Олег\Desktop\Проект Х\peachbitch\metalnode_id_ed25519")
HOST = "77.94.203.13"
PORT = 22024

# Manager IDs / GitHub repos from missing-packages dialog
REPOS = [
    ("https://github.com/chrisgoringe/cg-use-everywhere.git", "cg-use-everywhere"),
    ("https://github.com/cubiq/ComfyUI_essentials.git", "comfyui_essentials"),
    ("https://github.com/TinyTerra/ComfyUI_tinyterraNodes.git", "ComfyUI_tinyterraNodes"),
    ("https://github.com/ltdrdata/ComfyUI-Impact-Pack.git", "ComfyUI-Impact-Pack"),
    ("https://github.com/ltdrdata/ComfyUI-Impact-Subpack.git", "ComfyUI-Impact-Subpack"),
    ("https://github.com/EllangoK/ComfyUI-post-processing-nodes.git", "ComfyUI-post-processing-nodes"),
    ("https://github.com/ControlAltAI/ComfyUI-PromptControl.git", "ComfyUI-PromptControl"),  # may be wrong - controlaltai
    ("https://github.com/BadCafeCode/masquerade-nodes-comfyui.git", "masquerade-nodes-comfyui"),
    ("https://github.com/rgthree/rgthree-comfy.git", "rgthree-comfy"),
    ("https://github.com/numz/ComfyUI-SeedVR2_VideoUpscaler.git", "ComfyUI-SeedVR2_VideoUpscaler"),
    ("https://github.com/WASasquatch/was-node-suite-comfyui.git", "was-node-suite-comfyui"),
]

# Correct controlaltai + promptmodels (common repos)
EXTRA = [
    ("https://github.com/ControlAltAI/ComfyUI-FluxResolution.git", "ComfyUI-FluxResolution"),
    ("https://github.com/ControlAltAI/controlaltai-nodes.git", "controlaltai-nodes"),
    ("https://github.com/cubiq/ComfyUI_IPAdapter_plus.git", "ComfyUI_IPAdapter_plus"),  # skip if not needed
    ("https://github.com/Fannovel16/comfyui_controlnet_aux.git", "comfyui_controlnet_aux"),  # skip heavy
]

# Focused list actually needed - refined after checking names
REPOS_FINAL = [
    ("https://github.com/chrisgoringe/cg-use-everywhere.git", "cg-use-everywhere"),
    ("https://github.com/cubiq/ComfyUI_essentials.git", "ComfyUI_essentials"),
    ("https://github.com/TinyTerra/ComfyUI_tinyterraNodes.git", "ComfyUI_tinyterraNodes"),
    ("https://github.com/ltdrdata/ComfyUI-Impact-Pack.git", "ComfyUI-Impact-Pack"),
    ("https://github.com/ltdrdata/ComfyUI-Impact-Subpack.git", "ComfyUI-Impact-Subpack"),
    ("https://github.com/EllangoK/ComfyUI-post-processing-nodes.git", "ComfyUI-post-processing-nodes"),
    ("https://github.com/ControlAltAI/ComfyUI-ControlAltAI-Nodes.git", "ComfyUI-ControlAltAI-Nodes"),
    ("https://github.com/BadCafeCode/masquerade-nodes-comfyui.git", "masquerade-nodes-comfyui"),
    ("https://github.com/rgthree/rgthree-comfy.git", "rgthree-comfy"),
    ("https://github.com/numz/ComfyUI-SeedVR2_VideoUpscaler.git", "ComfyUI-SeedVR2_VideoUpscaler"),
    ("https://github.com/WASasquatch/was-node-suite-comfyui.git", "was-node-suite-comfyui"),
    # promptmodels - several candidates; Manager often maps PromptModels / PromptManager
    ("https://github.com/fizzleflop/PromptModels.git", "PromptModels"),
    ("https://github.com/AlekPet/ComfyUI_Custom_Nodes_AlekPet.git", "ComfyUI_Custom_Nodes_AlekPet"),
]


REMOTE = r'''#!/usr/bin/env python3
import os, subprocess, sys, time
from pathlib import Path

CN = Path("/work/ComfyUI/custom_nodes")
VENV_PIP = "/work/ai/venv/bin/pip"
VENV_PY = "/work/ai/venv/bin/python3"
LOG = Path("/work/INSTALL_NODES.log")

REPOS = [
    ("https://github.com/chrisgoringe/cg-use-everywhere.git", "cg-use-everywhere"),
    ("https://github.com/cubiq/ComfyUI_essentials.git", "ComfyUI_essentials"),
    ("https://github.com/TinyTerra/ComfyUI_tinyterraNodes.git", "ComfyUI_tinyterraNodes"),
    ("https://github.com/ltdrdata/ComfyUI-Impact-Pack.git", "ComfyUI-Impact-Pack"),
    ("https://github.com/ltdrdata/ComfyUI-Impact-Subpack.git", "ComfyUI-Impact-Subpack"),
    ("https://github.com/EllangoK/ComfyUI-post-processing-nodes.git", "ComfyUI-post-processing-nodes"),
    ("https://github.com/ControlAltAI/ComfyUI-ControlAltAI-Nodes.git", "ComfyUI-ControlAltAI-Nodes"),
    ("https://github.com/BadCafeCode/masquerade-nodes-comfyui.git", "masquerade-nodes-comfyui"),
    ("https://github.com/rgthree/rgthree-comfy.git", "rgthree-comfy"),
    ("https://github.com/numz/ComfyUI-SeedVR2_VideoUpscaler.git", "ComfyUI-SeedVR2_VideoUpscaler"),
    ("https://github.com/WASasquatch/was-node-suite-comfyui.git", "was-node-suite-comfyui"),
]

# promptmodels aliases / mirrors
PROMPT_CANDIDATES = [
    ("https://github.com/fizzleflop/PromptModels.git", "PromptModels"),
    ("https://github.com/Extraltodeus/ComfyUI-AutomaticCFG.git", None),  # noop placeholder skip
]

ALTS = {
    "ComfyUI-ControlAltAI-Nodes": [
        "https://github.com/ControlAltAI/ComfyUI-ControlAltAI-Nodes.git",
        "https://github.com/ControlAltAI/controlaltai-nodes.git",
        "https://github.com/gseth/ControlAltAI-Nodes.git",
    ],
    "PromptModels": [
        "https://github.com/fizzleflop/PromptModels.git",
        "https://github.com/SpaceNerdX/PromptModels.git",
        "https://github.com/kentsang231/PromptModels.git",
    ],
}

def log(msg):
    line = f"[{time.strftime('%H:%M:%S')}] {msg}"
    print(line, flush=True)
    with LOG.open("a", encoding="utf-8") as f:
        f.write(line + "\n")

def run(cmd, cwd=None, timeout=600):
    log("$ " + " ".join(cmd) + (f"  (cwd={cwd})" if cwd else ""))
    r = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, timeout=timeout)
    if r.stdout:
        log(r.stdout[-2000:])
    if r.returncode != 0 and r.stderr:
        log("ERR: " + r.stderr[-1500:])
    return r.returncode

def clone(url, name):
    dest = CN / name
    if dest.exists() and (dest / ".git").exists():
        log(f"EXISTS {name}")
        run(["git", "-C", str(dest), "pull", "--ff-only"], timeout=120)
        return dest
    if dest.exists():
        log(f"DIR exists without git: {name}")
        return dest
    rc = run(["git", "clone", "--depth", "1", url, str(dest)], timeout=300)
    if rc == 0:
        return dest
    return None

def pip_req(dest: Path):
    for req in ("requirements.txt", "requirements-lock.txt"):
        p = dest / req
        if p.exists():
            run([VENV_PIP, "install", "-q", "-r", str(p)], timeout=900)
            return
    # install.py patterns
    for script in ("install.py", "install.bat"):
        if (dest / "install.py").exists():
            run([VENV_PY, "install.py"], cwd=str(dest), timeout=900)
            break

def main():
    LOG.write_text("install custom nodes\n", encoding="utf-8")
    CN.mkdir(parents=True, exist_ok=True)
    # ensure git
    run(["git", "--version"])

    for url, name in REPOS:
        dest = None
        urls = ALTS.get(name, [url])
        if url not in urls:
            urls = [url] + urls
        for u in urls:
            dest = clone(u, name)
            if dest:
                break
            # cleanup failed dir
            d = CN / name
            if d.exists() and not (d / ".git").exists():
                import shutil
                shutil.rmtree(d, ignore_errors=True)
        if not dest:
            log(f"FAIL clone {name}")
            continue
        pip_req(dest)

    # PromptModels separate
    for u in ALTS["PromptModels"]:
        d = clone(u, "PromptModels")
        if d:
            pip_req(d)
            break

    # Impact Pack often needs subpack + ultralytics
    run([VENV_PIP, "install", "-q", "ultralytics", "segment-anything", "piexif", "dill"], timeout=600)

    # list installed
    log("=== custom_nodes ===")
    for p in sorted(CN.iterdir()):
        if p.is_dir() and not p.name.startswith("."):
            log("  " + p.name)

    Path("/work/INSTALL_NODES_DONE.txt").write_text("done\n", encoding="utf-8")
    log("DONE")

if __name__ == "__main__":
    main()
'''


def connect():
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    pkey = paramiko.Ed25519Key.from_private_key_file(str(KEY))
    for i in range(8):
        try:
            c.connect(HOST, port=PORT, username="root", pkey=pkey, timeout=60, allow_agent=False, look_for_keys=False)
            t = c.get_transport()
            if t:
                t.set_keepalive(20)
            return c
        except Exception as e:
            print("retry", i, e)
            time.sleep(2)
    raise SystemExit("ssh fail")


def main():
    c = connect()
    sftp = c.open_sftp()
    with sftp.file("/tmp/install_nodes.py", "w") as f:
        f.write(REMOTE)
    sftp.close()
    print("uploaded installer", flush=True)

    # run in foreground with long timeout — clones + pip can take several minutes
    stdin, stdout, stderr = c.exec_command(
        "nohup /work/ai/venv/bin/python3 -u /tmp/install_nodes.py > /work/INSTALL_NODES.nohup 2>&1 & echo PID=$!; sleep 2; pgrep -af install_nodes",
        get_pty=True,
        timeout=30,
    )
    print(stdout.read().decode(errors="replace"))
    c.close()
    print("installer kicked")


if __name__ == "__main__":
    main()
