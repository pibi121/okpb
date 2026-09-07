#!/usr/bin/env python3
import json
import urllib.request

payload = {
    "model": "gemma4-heretic",
    "stream": False,
    "think": False,
    "messages": [
        {
            "role": "system",
            "content": "Merge into ONE English NSFW image prompt. Output ONLY the prompt paragraph.",
        },
        {
            "role": "user",
            "content": (
                "STYLE: warm lamp\n"
                "POSE: cowgirl nude straddling, cock buried\n"
                "CHARACTER_WOMAN: trigger=olh_person; petite athletic long dark hair\n"
                "CHARACTER_MAN: large bald muscular adult man\n"
                "Merge. ONLY the prompt."
            ),
        },
    ],
    "options": {"num_predict": 220, "temperature": 0.7, "num_ctx": 4096},
}
req = urllib.request.Request(
    "http://127.0.0.1:11434/api/chat",
    data=json.dumps(payload).encode(),
    headers={"Content-Type": "application/json"},
)
with urllib.request.urlopen(req, timeout=120) as r:
    data = json.loads(r.read().decode())
print((data.get("message") or {}).get("content", "")[:800])
