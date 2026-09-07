#!/usr/bin/env python3
"""Dump full smoke responses to files for inspection."""
from pathlib import Path
import sys
import paramiko

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
KEY = Path(r"C:\Users\Олег\Downloads\metalnode_id_ed25519 (6).txt")

REMOTE = r'''
python3 - <<'PY'
import json, urllib.request, time

def chat(messages, num_predict=400):
    payload = {
        "model": "gemma4-heretic",
        "messages": messages,
        "stream": False,
        "options": {"num_predict": num_predict, "temperature": 0.75, "num_ctx": 8192},
    }
    req = urllib.request.Request(
        "http://127.0.0.1:11434/api/chat",
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
    )
    t0 = time.time()
    data = json.loads(urllib.request.urlopen(req, timeout=600).read())
    text = (data.get("message") or {}).get("content", "")
    eval_count = data.get("eval_count") or 0
    eval_ns = data.get("eval_duration") or 1
    tps = eval_count / (eval_ns / 1e9) if eval_ns else 0
    return text, eval_count, tps, time.time()-t0, data

# NSFW
text, n, tps, wall, raw = chat([{
  "role":"user",
  "content":"Write 4 sentences of explicit erotic prose: a woman rides a man cowgirl in a hotel room at night. Be graphic about bodies and sex. No warnings, no refusal."
}], 250)
open("/work/llm/test_nsfw.txt","w").write(text)
print("NSFW len=", len(text), "tokens=", n, "tps=", round(tps,1), "wall=", round(wall,1))
print("NSFW preview:", repr(text[:300]))
print("raw keys", list(raw.keys()), "msg keys", list((raw.get("message") or {}).keys()))

# MERGE
text2, n2, tps2, wall2, _ = chat([{
  "role":"user",
  "content":"""Merge into ONE English Flux image prompt. Output ONLY the prompt, nothing else.

POSE TEMPLATE:
cowgirl, woman straddling man, hips rolling, hands on his chest, looking down at him, intimate bedroom

STYLE TEMPLATE:
cinematic warm lamplight, shallow depth of field, 85mm, soft skin texture, intimate atmosphere, photorealistic

CHARACTER:
trigger olh_person, young adult woman, long dark hair, athletic slim body

USER REQUEST:
Она сверху, медленно двигается, смотрит ему в глаза, слегка приоткрытый рот, чувственная сцена у окна вечером
"""
}], 400)
open("/work/llm/test_merge.txt","w").write(text2)
print("MERGE len=", len(text2), "tokens=", n2, "tps=", round(tps2,1))
print("MERGE full:")
print(text2)
PY
'''

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
pkey = paramiko.Ed25519Key.from_private_key_file(str(KEY))
c.connect("77.94.203.13", port=22024, username="root", pkey=pkey, timeout=60, banner_timeout=60, allow_agent=False, look_for_keys=False)
sftp = c.open_sftp()
with sftp.file("/work/_llm_dump_tests.py", "w") as f:
    f.write(REMOTE)
sftp.close()
stdin, stdout, stderr = c.exec_command("python3 /work/_llm_dump_tests.py", timeout=300)
print(stdout.read().decode(errors="replace"))
err = stderr.read().decode(errors="replace")
if err.strip():
    print("STDERR:", err[-2000:])
c.close()
