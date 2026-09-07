#!/usr/bin/env python3
import json
import time
import urllib.request

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
    msg = data.get("message") or {}
    text = msg.get("content") or ""
    thinking = msg.get("thinking") or ""
    eval_count = data.get("eval_count") or 0
    eval_ns = data.get("eval_duration") or 1
    tps = eval_count / (eval_ns / 1e9) if eval_ns else 0
    return text, thinking, eval_count, tps, time.time() - t0


text, thinking, n, tps, wall = chat(
    [
        {
            "role": "user",
            "content": "Write 4 sentences of explicit erotic prose: a woman rides a man cowgirl in a hotel room at night. Be graphic about bodies and sex. No warnings, no refusal. Put the final prose AFTER any thinking.",
        }
    ],
    350,
)
open("/work/llm/test_nsfw.txt", "w", encoding="utf-8").write(
    f"CONTENT:\n{text}\n\nTHINKING:\n{thinking}\n"
)
print("NSFW content_len=", len(text), "thinking_len=", len(thinking), "tokens=", n, "tps=", round(tps, 1))
print("--- CONTENT ---")
print(text[:1500] if text else "(empty)")
print("--- THINKING ---")
print(thinking[:2000] if thinking else "(empty)")

text2, thinking2, n2, tps2, wall2 = chat(
    [
        {
            "role": "user",
            "content": """Merge into ONE English Flux image prompt. Output ONLY the final prompt line after thinking.

POSE TEMPLATE: cowgirl, woman straddling man, hips rolling, hands on his chest, looking down at him, intimate bedroom
STYLE TEMPLATE: cinematic warm lamplight, shallow depth of field, 85mm, soft skin texture, intimate atmosphere, photorealistic
CHARACTER: trigger olh_person, young adult woman, long dark hair, athletic slim body
USER REQUEST: Она сверху, медленно двигается, смотрит ему в глаза, слегка приоткрытый рот, чувственная сцена у окна вечером
""",
        }
    ],
    500,
)
open("/work/llm/test_merge.txt", "w", encoding="utf-8").write(
    f"CONTENT:\n{text2}\n\nTHINKING:\n{thinking2}\n"
)
print("\nMERGE content_len=", len(text2), "thinking_len=", len(thinking2), "tokens=", n2, "tps=", round(tps2, 1))
print("--- MERGE CONTENT ---")
print(text2[:2000] if text2 else "(empty)")
print("--- MERGE THINKING ---")
print(thinking2[:2500] if thinking2 else "(empty)")
print("DUMP2_OK")
