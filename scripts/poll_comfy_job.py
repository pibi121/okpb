#!/usr/bin/env python3
import json
import sys
import time
import urllib.request

pid = sys.argv[1] if len(sys.argv) > 1 else "009f9b81-8730-47f3-8696-c3085c575072"
t0 = time.time()
while True:
    with urllib.request.urlopen(f"http://127.0.0.1:8188/history/{pid}", timeout=60) as r:
        hist = json.loads(r.read().decode())
    with urllib.request.urlopen("http://127.0.0.1:8188/queue", timeout=30) as r:
        q = json.loads(r.read().decode())
    running = q.get("queue_running") or []
    pending = q.get("queue_pending") or []
    print(f"t={time.time()-t0:.0f}s running={len(running)} pending={len(pending)} in_hist={pid in hist}")
    if pid in hist:
        st = hist[pid].get("status", {})
        print("status", st.get("status_str"))
        print("outputs", json.dumps(hist[pid].get("outputs", {}), indent=2)[:1500])
        for m in (st.get("messages") or [])[-8:]:
            print("msg", m)
        raise SystemExit(0 if st.get("status_str") == "success" else 1)
    time.sleep(5)
