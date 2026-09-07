#!/usr/bin/env bash
set -euo pipefail
python3 - <<'PY'
import json, urllib.request, time
payload = {
  "model": "gemma4-heretic",
  "stream": False,
  "messages": [
    {"role": "system", "content": "You are an expert adult erotic prompt engineer for Krea 2. Output ONLY one English image prompt, no markdown."},
    {"role": "user", "content": "STYLE: warm bedroom lamp, soft shadows, intimate close framing\nPOSE: woman completely nude straddling a man, on top sitting upright on his hips, his thick cock buried deep inside her pussy, thighs spread over him, hands on his chest, looking at him\nCHARACTER_WOMAN: trigger=olh_person; petite young woman, athletic slim body, long dark hair, natural face from character LoRA\nCHARACTER_MAN: large bald muscular adult man\nUSER: bedroom at night\nMerge into ONE English Krea/Flux image prompt. Output ONLY the prompt."}
  ],
  "options": {"num_predict": 250, "temperature": 0.7, "num_ctx": 4096},
}
t0 = time.time()
req = urllib.request.Request(
    "http://127.0.0.1:11434/api/chat",
    data=json.dumps(payload).encode(),
    headers={"Content-Type": "application/json"},
)
with urllib.request.urlopen(req, timeout=600) as r:
    data = json.loads(r.read().decode())
elapsed = time.time() - t0
msg = data.get("message") or {}
content = (msg.get("content") or msg.get("thinking") or "").strip()
print(f"ELAPSED_SEC={elapsed:.1f}")
print("---PROMPT---")
print(content[:2000] if content else json.dumps(data)[:2000])
PY
nvidia-smi --query-gpu=memory.used,memory.total --format=csv,noheader
