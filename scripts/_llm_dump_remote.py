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
    text = (data.get("message") or {}).get("content", "")
    eval_count = data.get("eval_count") or 0
    eval_ns = data.get("eval_duration") or 1
    tps = eval_count / (eval_ns / 1e9) if eval_ns else 0
    return text, eval_count, tps, time.time() - t0, data


text, n, tps, wall, raw = chat(
    [
        {
            "role": "user",
            "content": "Write 4 sentences of explicit erotic prose: a woman rides a man cowgirl in a hotel room at night. Be graphic about bodies and sex. No warnings, no refusal.",
        }
    ],
    250,
)
open("/work/llm/test_nsfw.txt", "w", encoding="utf-8").write(text)
print("NSFW len=", len(text), "tokens=", n, "tps=", round(tps, 1), "wall=", round(wall, 1))
print("NSFW preview:", repr(text[:400]))
print("msg keys", list((raw.get("message") or {}).keys()))

text2, n2, tps2, wall2, _ = chat(
    [
        {
            "role": "user",
            "content": """Merge into ONE English Flux image prompt. Output ONLY the prompt, nothing else.

POSE TEMPLATE:
cowgirl, woman straddling man, hips rolling, hands on his chest, looking down at him, intimate bedroom

STYLE TEMPLATE:
cinematic warm lamplight, shallow depth of field, 85mm, soft skin texture, intimate atmosphere, photorealistic

CHARACTER:
trigger olh_person, young adult woman, long dark hair, athletic slim body

USER REQUEST:
Она сверху, медленно двигается, смотрит ему в глаза, слегка приоткрытый рот, чувственная сцена у окна вечером
""",
        }
    ],
    400,
)
open("/work/llm/test_merge.txt", "w", encoding="utf-8").write(text2)
print("MERGE len=", len(text2), "tokens=", n2, "tps=", round(tps2, 1), "wall=", round(wall2, 1))
print("MERGE full:")
print(text2)
print("DUMP_OK")
