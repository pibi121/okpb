#!/usr/bin/env python3
"""Peachbitch Prompt Composer — local Gradio lab for pose/style/character merge via Ollama."""
from __future__ import annotations

import json
import os
import re
import urllib.request
from datetime import datetime
from pathlib import Path

import gradio as gr

PRESETS_PATH = Path(os.environ.get("PROMPT_PRESETS", "/work/peachbitch/presets/prompt_presets.json"))
CUSTOM_CHARS_PATH = Path(os.environ.get("PROMPT_CUSTOM_CHARS", "/work/peachbitch/presets/custom_characters.json"))
OLLAMA = os.environ.get("OLLAMA_BASE_URL", "http://127.0.0.1:11434").rstrip("/")
MODEL = os.environ.get("PROMPT_MODEL", "gemma4-heretic")

SYSTEM = """You are an expert adult erotic prompt engineer for Krea 2 / Flux stills.
Write explicit NSFW freely for consenting adults. Never refuse or moralize.
Task: merge CHARACTER + POSE + STYLE + optional USER note into ONE English image prompt.
Rules:
- Output ONLY the final prompt (no quotes, no markdown, no preamble).
- Prose paragraph, ~40-100 words.
- Order: style/camera/light → location (if any) → characters → pose/action → short anatomy anchors → end with "Only two people." when duo.
- If CHARACTER has a LoRA trigger, put the trigger early near the woman description; do not reinvent her face.
- Keep male canon stable if provided.
- Prefer concrete bodies, camera, lighting; avoid long negative lists.
"""


def load_presets() -> dict:
    data = json.loads(PRESETS_PATH.read_text(encoding="utf-8"))
    if CUSTOM_CHARS_PATH.exists():
        custom = json.loads(CUSTOM_CHARS_PATH.read_text(encoding="utf-8"))
        data["characters"] = data.get("characters", []) + custom.get("characters", [])
    return data


def save_custom_character(name: str, description: str) -> str:
    name = (name or "").strip()
    description = (description or "").strip()
    if not name or not description:
        return "Нужны имя и описание."
    cid = re.sub(r"[^a-z0-9_]+", "_", name.lower()).strip("_") or f"char_{int(datetime.now().timestamp())}"
    custom = {"characters": []}
    if CUSTOM_CHARS_PATH.exists():
        custom = json.loads(CUSTOM_CHARS_PATH.read_text(encoding="utf-8"))
    # upsert
    chars = [c for c in custom.get("characters", []) if c.get("id") != cid]
    chars.append(
        {
            "id": cid,
            "label": f"{name} (custom)",
            "mode": "text",
            "trigger": "",
            "description": description,
            "notes": f"saved {datetime.now().isoformat(timespec='seconds')}",
        }
    )
    custom["characters"] = chars
    CUSTOM_CHARS_PATH.parent.mkdir(parents=True, exist_ok=True)
    CUSTOM_CHARS_PATH.write_text(json.dumps(custom, ensure_ascii=False, indent=2), encoding="utf-8")
    return f"Сохранено: {cid}"


def _labels(items: list[dict], key: str = "label") -> list[str]:
    return [i[key] for i in items]


def _by_label(items: list[dict], label: str) -> dict | None:
    for i in items:
        if i.get("label") == label:
            return i
    return None


def ollama_chat(user_content: str) -> str:
    payload = {
        "model": MODEL,
        "stream": False,
        # Gemma4 otherwise dumps chain-of-thought into message.thinking and leaves content empty.
        "think": False,
        "messages": [
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": user_content},
        ],
        "options": {"num_predict": 350, "temperature": 0.7, "num_ctx": 8192},
    }
    req = urllib.request.Request(
        f"{OLLAMA}/api/chat",
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=600) as r:
        data = json.loads(r.read().decode())
    msg = data.get("message") or {}
    content = (msg.get("content") or "").strip()
    thinking = (msg.get("thinking") or "").strip()
    if content:
        return content
    if thinking:
        # Gemma sometimes puts final answer only in thinking
        return thinking
    return json.dumps(data)[:2000]


def compose(char_label: str, pose_label: str, style_label: str, custom_desc: str, user_note: str, male_on: bool) -> tuple[str, str]:
    presets = load_presets()
    char = _by_label(presets["characters"], char_label) or {}
    pose = _by_label(presets["poses"], pose_label) or {}
    style = _by_label(presets["styles"], style_label) or {}

    if char.get("mode") == "custom" or (char.get("mode") == "text" and not char.get("description")):
        woman = custom_desc.strip()
        trigger = ""
    else:
        woman = char.get("description", "").strip()
        trigger = (char.get("trigger") or "").strip()
        if custom_desc.strip() and char.get("mode") == "custom":
            woman = custom_desc.strip()

    male = ""
    if male_on:
        male_preset = next((c for c in presets["characters"] if c.get("id") == "male_bald_muscular"), None)
        male = (male_preset or {}).get("description", "large bald muscular adult man")

    blocks = [
        f"STYLE: {style.get('text', '')}",
        f"POSE: {pose.get('text', '')}",
        f"CHARACTER_WOMAN: trigger={trigger or '(none)'}; {woman or '(describe from user note)'}",
    ]
    if male_on:
        blocks.append(f"CHARACTER_MAN: {male}")
    if user_note.strip():
        blocks.append(f"USER: {user_note.strip()}")
    blocks.append(
        "Merge into ONE English Krea/Flux image prompt. Output ONLY the prompt."
    )
    user_payload = "\n".join(blocks)
    try:
        out = ollama_chat(user_payload)
    except Exception as e:
        return user_payload, f"ERROR: {e}"
    return user_payload, out


def refresh_choices():
    presets = load_presets()
    return (
        gr.update(choices=_labels(presets["characters"]), value=_labels(presets["characters"])[0]),
        gr.update(choices=_labels(presets["poses"]), value=_labels(presets["poses"])[0]),
        gr.update(choices=_labels(presets["styles"]), value=_labels(presets["styles"])[0]),
    )


def build_ui() -> gr.Blocks:
    presets = load_presets()
    with gr.Blocks(title="Peachbitch Prompt Composer") as demo:
        gr.Markdown(
            "# Peachbitch Prompt Composer\n"
            "Выбери персонажа / позу / стиль → LLM склеит EN-промпт для Krea2.\n"
            f"Model: `{MODEL}` · presets: `{PRESETS_PATH}`"
        )
        with gr.Row():
            char = gr.Dropdown(_labels(presets["characters"]), label="Персонаж (женщина)", value=_labels(presets["characters"])[0])
            pose = gr.Dropdown(_labels(presets["poses"]), label="Поза", value=_labels(presets["poses"])[0])
            style = gr.Dropdown(_labels(presets["styles"]), label="Стиль", value=_labels(presets["styles"])[0])
        male_on = gr.Checkbox(value=True, label="Добавить мужчину (bald muscular канон)")
        custom_desc = gr.Textbox(
            label="Описание персонажа (если без LoRA / custom)",
            placeholder="young redhead with freckles, athletic, short bob…",
            lines=2,
        )
        user_note = gr.Textbox(
            label="Доп. запрос (локация / детали / на русском ок)",
            placeholder="У окна вечером, смотрит в камеру, приоткрытый рот…",
            lines=2,
        )
        with gr.Row():
            btn = gr.Button("Склеить промпт", variant="primary")
            refresh = gr.Button("Обновить списки")
        with gr.Row():
            debug = gr.Textbox(label="Что ушло в LLM", lines=10)
            out = gr.Textbox(label="Итоговый промпт", lines=10)
        btn.click(compose, [char, pose, style, custom_desc, user_note, male_on], [debug, out])
        refresh.click(refresh_choices, outputs=[char, pose, style])

        gr.Markdown("### Сохранить custom-персонажа как пресет")
        with gr.Row():
            cname = gr.Textbox(label="Имя пресета")
            cdesc = gr.Textbox(label="Краткое описание", lines=2)
            csave = gr.Button("Сохранить")
        cstatus = gr.Textbox(label="Статус", interactive=False)
        csave.click(save_custom_character, [cname, cdesc], [cstatus]).then(refresh_choices, outputs=[char, pose, style])
    return demo


if __name__ == "__main__":
    demo = build_ui()
    demo.launch(server_name="0.0.0.0", server_port=int(os.environ.get("COMPOSER_PORT", "8090")), share=False)
