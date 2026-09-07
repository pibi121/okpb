#!/usr/bin/env python3
"""Poll DiT+env, then launch Klein character LoRA training."""
from pathlib import Path
import paramiko
import sys
import time

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.stdout.reconfigure(line_buffering=True)

KEY = Path(r"C:\Users\Олег\Downloads\metalnode_id_ed25519 (1).txt")
SCR = Path(__file__).with_name("_metalnode_run_klein_lora_train.sh")


def connect():
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    pkey = paramiko.Ed25519Key.from_private_key_file(str(KEY))
    c.connect(
        "77.94.203.13",
        port=22024,
        username="root",
        pkey=pkey,
        timeout=90,
        allow_agent=False,
        look_for_keys=False,
        banner_timeout=90,
    )
    return c


def run(cmd, timeout=60):
    for attempt in range(5):
        try:
            c = connect()
            _, so, se = c.exec_command(cmd, timeout=timeout)
            out = so.read().decode("utf-8", errors="replace")
            c.close()
            return out
        except Exception as e:
            print(f"ssh_err {attempt}: {e}", flush=True)
            time.sleep(10)
    raise RuntimeError("ssh failed")


def main():
    c = connect()
    sftp = c.open_sftp()
    sftp.put(str(SCR), "/tmp/run_klein_lora_train.sh")
    sftp.close()
    c.close()

    for i in range(80):
        out = run(
            "stat -c%s /work/train/models/flux-2-klein-base-9b-fp8.safetensors 2>/dev/null || "
            "stat -c%s /work/train/models/flux-2-klein-base-9b-fp8.safetensors.part 2>/dev/null || echo 0; "
            "pgrep -c curl || echo 0; "
            "grep -E 'ENV_OK|DIT_READY|curl_dit_exit' /work/KLEIN_TRAIN_SETUP.log /work/KLEIN_DIT.nohup /work/KLEIN_MUSUBI_ENV.log 2>/dev/null | tail -10; "
            "tail -c 200 /work/KLEIN_TRAIN_SETUP.log 2>/dev/null | tr '\\r' '\\n' | tail -2"
        )
        print(f"=== wait {i} ===", flush=True)
        print(out[-900:], flush=True)
        # ready when DIT final exists (>=9GB) and ENV_OK
        if "ENV_OK" in out and "DIT_READY" in out:
            break
        # also check size line
        lines = out.strip().splitlines()
        size = 0
        try:
            size = int(lines[0])
        except Exception:
            pass
        if size >= 9000000000 and "ENV_OK" in out:
            break
        time.sleep(30)
    else:
        print("PREP_TIMEOUT", flush=True)
        # still try to launch; train script waits internally
        pass

    out = run(
        "nohup bash /tmp/run_klein_lora_train.sh > /work/loras_out/olh_person_klein_train.nohup 2>&1 & "
        "echo $! > /work/loras_out/olh_person_klein_train.pid; "
        "sleep 3; echo PID:$(cat /work/loras_out/olh_person_klein_train.pid); "
        "tail -20 /work/loras_out/olh_person_klein_train.log 2>/dev/null || "
        "tail -20 /work/loras_out/olh_person_klein_train.nohup",
        timeout=30,
    )
    print(out, flush=True)
    print("TRAIN_LAUNCHED", flush=True)

    # poll training
    for i in range(360):
        time.sleep(60)
        out = run(
            "tail -c 800 /work/loras_out/olh_person_klein_train.log 2>/dev/null | tr '\\r' '\\n' | tail -15; "
            "ls -lh /work/loras_out/olh_person_klein/*.safetensors 2>/dev/null | tail -5; "
            "pgrep -af 'flux_2_train_network|run_klein_lora' | head -3 || echo NO_TRAIN_PROC; "
            "grep -E 'TRAIN_DONE|ALL_DONE|Error|Traceback|CACHE_' /work/loras_out/olh_person_klein_train.log 2>/dev/null | tail -10"
        )
        print(f"=== train {i} ===", flush=True)
        print(out[-1200:], flush=True)
        if "ALL_DONE" in out or "TRAIN_DONE" in out:
            print("TRAIN_COMPLETE", flush=True)
            break
    else:
        print("TRAIN_POLL_TIMEOUT", flush=True)


if __name__ == "__main__":
    main()
