# Диалог PoC: TTS → MuseTalk (Metalnode)

Дата: 2026-08-07

> **Photo talking-head (Hedra-style):** фото + WAV без готового видео → [`PHOTO-TALKINGHEAD.md`](./PHOTO-TALKINGHEAD.md) (**InfiniteTalk / MultiTalk**).  
> Этот файл — про **MuseTalk** (lipsync на уже существующем клипе).  
> **MiniMax H3 (локально, open weights):** видео + голос + липсинк в одном проходе, T2V/I2V/R2V → [`MINIMAX-H3.md`](./MINIMAX-H3.md).

## Стек

| Шаг | Чем |
|-----|-----|
| Текст → голос | **Qwen3-TTS** / **Chatterbox Turbo** (A/B) или Piper backup |
| Голос → губы | **MuseTalk** (`muse_talk_sampler`) |
| Видео in/out | **VHS** Load/Combine |
| VAE | `sd-vae-ft-mse.safetensors` (не Wan!) |

Готово на сервере:
- workflow: **`musetalk_dialogue_example`**
- **Qwen3 smoke WAV:** `input/tts_qwen3_line.wav` («I missed you so much. Come closer.») — 16 kHz mono, ~2.08 s
- **Chatterbox Turbo smoke WAV:** `input/tts_chatter_line.wav` (та же фраза, тот же ref female_01) — 16 kHz mono, ~2.76 s
- Qwen3 model: `models/TTS/qwen3_tts/Qwen3-TTS-12Hz-1.7B-Base`
- Chatterbox Turbo: `models/TTS/chatterbox_turbo/` + `chatterbox-tts==0.1.7`
- Suite: `custom_nodes/TTS-Audio-Suite` → `Qwen3TTSEngineNode`, `ChatterBoxEngineNode` (classic; Turbo пока CLI)
- CLI: `/work/scripts/qwen3_tts_generate.py`, `/work/scripts/chatterbox_tts_generate.py`
- пробный Piper wav: `input/dialogue_test.wav` («Hello. My name is Olga…»)
- голос Piper: `models/piper_tts/en_US-lessac-medium.onnx`

---

## Подключение

```bash
ssh -i "path/to/metalnode_id_ed25519 (3).txt" -L 8188:localhost:8188 root@$METALNODE_HOST -p 22026
```
http://127.0.0.1:8188 → **Ctrl+F5**

---

## Проверка за 10 минут

### A) Свой текст → wav (вариант 1: скрипт)

В SSH на сервере:

```bash
bash /work/scripts_tts_dialogue.sh "I missed you so much. Come closer." /work/ComfyUI/input/my_line.wav
```

### A′) Свой текст → wav (вариант 2: Comfy)

1. Нода **Piper TTS** (на сервере починена: пишет валидный WAV через `synthesize_wav`)
2. text = ваша фраза (EN лучше для этого голоса)
3. voice ≈ `en_US-lessac`, quality `medium`
4. Queue → wav в `output/piper_tts/` (скачать из History / Save)

### B) Lipsync

1. Workflows → **Load** (не «Обзор») → файл с рабочего стола:  
   **`./local/musetalk_dialogue_READY.json`**  
   (копия также: `peachbitch/workflows/musetalk_dialogue_READY.json` и на сервере `musetalk_dialogue_READY`)
2. **VHS_LoadVideo** — клип с **крупным лицом** (фронт). Сейчас по умолчанию `ComfyUI2Scale_00004_.mp4` — лучше подставь свой face-closeup в `input/`
3. **VHS_LoadAudio** → **`tts_chatter_line.wav`** (уже проставлено; не обычный LoadAudio)
4. Между audio и MuseTalk стоит мост **`VHS_AudioToVHSAudio`** (новый VHS отдаёт `AUDIO`, MuseTalk ждёт `VHS_AUDIO`)
5. **VAELoader** → **`sd-vae-ft-mse`**
6. Queue → смотри ноду **▶ RESULT preview (MuseTalk + audio)** — видео прямо в Comfy (и файл в `output/`)

### Успех
- Слышна ваша фраза  
- Рот синхронно открывается/закрывается  
- Лицо не размазано по всему кадру  

### Если плохо
- Лицо мелко / в профиль → возьми клип крупнее  
- Длина audio > длина video → укороти фразу или удлини клип  
- Красные ноды → Ctrl+F5; переоткрой workflow  
- `method True/False` на ImageResize+ — уже починено (`keep proportion` / `stretch`)  
- Не тот VAE (Wan) → будет мусор  

---

## Живая озвучка: Qwen3-TTS (smoke ok)

Piper слишком «электронный». **Qwen3-TTS Base 1.7B уже на Metalnode** — детали, regenerate, gotchas: **[`TTS-NATURAL.md`](./TTS-NATURAL.md)** (секция «Metalnode: Qwen3-TTS установлен»).

Быстрый CLI:

```bash
/work/ai/venv/bin/python /work/scripts/qwen3_tts_generate.py \
  --text "I missed you so much. Come closer." \
  --out /work/ComfyUI/input/tts_qwen3_line.wav
```

В MuseTalk workflow подставь `tts_qwen3_line.wav` или `tts_chatter_line.wav` вместо Piper. Ref пока demo female из Suite — для персонажа Olga нужен свой `voice_olga_ref.wav`.

---

## Живая озвучка: Chatterbox (тест в Comfy)

**Turbo** в Suite UI пока нет — в Comfy крутится **classic** ChatterBox. Готовый Turbo-сэмпл уже в `input/tts_chatter_line.wav`.

### A) Быстро: готовый WAV → MuseTalk

1. Workflows → **`musetalk_dialogue_example`**
2. **VHS_LoadVideo** — клип с крупным лицом (фронт)
3. **VHS_LoadAudio** / LoadAudio → **`tts_chatter_line.wav`**
4. **VAELoader** → **`sd-vae-ft-mse`**
5. Queue → смотри **VHS_VideoCombine**

### A′) Свой текст в Comfy (classic ChatterBox)

1. Load → **`Chatterbox integration`**  
   (или ноды **⚙️ ChatterBox TTS Engine** + **🎤 TTS Text**)
2. Engine: language **English**
3. Голос: **`voices_examples/female/female_01.wav`**  
   (через **🎭 Character Voices** → `opt_narrator`, или прямо `narrator_voice` в TTS Text)
4. В **🎤 TTS Text** — короткая EN-фраза; вход `TTS_engine` с Engine
5. К audio → **Preview Audio** (и Save Audio при желании)
6. Queue → слушай Preview; сохрани wav в `input/`
7. Открой **`musetalk_dialogue_example`** → LoadAudio = твой wav → Queue

Детали / CLI Turbo: **[`TTS-NATURAL.md`](./TTS-NATURAL.md)**.

---

## Для платформы (позже)

```
сценарий.dialogue → Qwen3/CosyVoice/Chatterbox (TTS; не Piper)
                 → MuseTalk на шоты с лицом
                 → mux audio+video
```

Отдельно от Remix-action и от SFX-библиотеки.

---

## Быстрые пути файлов

| Файл | Путь |
|------|------|
| Пример workflow | `/work/ComfyUI/user/default/workflows/musetalk_dialogue_example.json` |
| Qwen3 тест-речь | `/work/ComfyUI/input/tts_qwen3_line.wav` |
| Chatterbox Turbo тест-речь | `/work/ComfyUI/input/tts_chatter_line.wav` |
| Piper тест-речь | `/work/ComfyUI/input/dialogue_test.wav` |
| Qwen3 CLI | `/work/ai/venv/bin/python /work/scripts/qwen3_tts_generate.py --text "…" --out /path/out.wav` |
| Chatterbox CLI | `/work/ai/venv/bin/python /work/scripts/chatterbox_tts_generate.py --text "…" --out /path/out.wav` |
| Piper CLI | `bash /work/scripts_tts_dialogue.sh "text" /path/out.wav` |
| SD VAE | `/work/ComfyUI/models/vae/sd-vae-ft-mse.safetensors` |
