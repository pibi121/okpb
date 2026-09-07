# Живая озвучка (TTS) для диалога → MuseTalk

Дата: **2026-08-07**  
Контекст: Piper отвергнут (электронный). Нужна **натуральная** женская EN-речь (позже multilingual), self-host на Metalnode (RTX **5090 / 32 GB**), WAV для MuseTalk.  
Статус: **Qwen3-TTS + Chatterbox Turbo smoke-test на Metalnode пройдены** (WAV готовы для MuseTalk A/B). Лицензии перепроверить перед коммерческим продом.

---

## Вердикт: что ставить первым

| # | Модель | Почему именно для peachbitch |
|---|--------|------------------------------|
| **1** | **Qwen3-TTS** (1.7B Base / CustomVoice) | SOTA-уровень натуральности, клон с ~3 с, эмоции текстом, **Apache 2.0**, ComfyUI, ~4–8 GB VRAM |
| **2** | **CosyVoice 3** (Fun-CosyVoice3-0.5B) | Сильный zero-shot / cross-lingual, instruct, **Apache 2.0**, лёгкий, ComfyUI |
| **3** | **Chatterbox** (Turbo EN / Multilingual) | Очень «живой» EN, exaggeration / tags, **MIT**, родной ComfyUI (TTS Audio Suite) |

**Не брать в первый заход:** Piper (уже), Tortoise/Bark/StyleTTS2/MeloTTS (устарели по качеству), Fish Speech S2 (сложная NC-лицензия), XTTS-v2 (старее + лицензионный риск Coqui/AGPL-ish).

**Metalnode (2026-08-07 smoke):** **Qwen3-TTS** и **Chatterbox Turbo** установлены и прогнаны (см. секции ниже). CosyVoice ещё нет. Piper остаётся как старый backup.

---

## Metalnode: Chatterbox Turbo установлен (smoke 2026-08-07)

| Что | Путь / факт |
|-----|-------------|
| Выбор модели | **Chatterbox-Turbo** 350M EN (`ResembleAI/chatterbox-turbo`) — newest best for EN dialogue / clone; MIT; paralinguistic tags (`[laugh]` и т.п.) |
| Почему не MTL V3 | Multilingual V3 лучше для RU/cross-lingual позже; для текущего EN A/B Turbo приоритетнее |
| Python package | `chatterbox-tts==0.1.7` в `/work/ai/venv` (**`--no-deps`**: полный pip тянет torch 2.6 / transformers 5.2 и ломает Comfy/Qwen) |
| Extra deps | `conformer==0.3.2`, `resemble-perth`, `pyloudnorm`, `s3tokenizer` (torch/transformers/numpy **не** трогали) |
| Weights (Turbo) | `/work/ComfyUI/models/TTS/chatterbox_turbo/` (~3.8 GB: `t3_turbo_v1`, `s3gen_meanflow`, `ve`, tokenizer, `conds.pt`) |
| Weights (Suite classic EN) | `/work/ComfyUI/models/TTS/chatterbox/English/` (ResembleAI/chatterbox — для Comfy Suite node) |
| CLI regenerate | `/work/scripts/chatterbox_tts_generate.py` |
| Smoke WAV | `/work/ComfyUI/input/tts_chatter_line.wav` — **16 kHz mono PCM s16le**, ~2.76 s, ~88 KB |
| Local copy | `peachbitch/samples/tts_chatter_line.wav` |
| Demo ref (как Qwen3) | Suite `voices_examples/female/female_01.wav` |
| Comfy Suite nodes | `ChatterBoxEngineNode` (classic EN / community langs), `ChatterBoxOfficial23LangEngineNode` — **Suite v5.6.5 ещё без Turbo-ноды**; Turbo = CLI / official package |
| Comfy HTTP | `8188` → 200 (рестарт не требовался) |

### Регенерация CLI (Turbo)

```bash
ssh -i "…/metalnode_id_ed25519 (2).txt" -p 22022 root@$METALNODE_HOST
/work/ai/venv/bin/python /work/scripts/chatterbox_tts_generate.py \
  --text "I missed you so much. Come closer." \
  --ref-audio /work/ComfyUI/custom_nodes/TTS-Audio-Suite/voices_examples/female/female_01.wav \
  --out /work/ComfyUI/input/tts_chatter_line.wav
```

### ComfyUI (classic ChatterBox через Suite)

1. SSH tunnel: `-L 8188:localhost:8188` port **22022**
2. Нода **ChatterBox TTS Engine** (`ChatterBoxEngineNode`) + Character Voices / TTS Text
3. Language: **English** (веса в `models/TTS/chatterbox/English/`)
4. Для лучшего EN качества пока используй CLI Turbo → `tts_chatter_line.wav`, затем MuseTalk

### Gotchas (Chatterbox)

- **Не** `pip install chatterbox-tts` без `--no-deps` — даунгрейдит torch до 2.6.
- numpy 2.x → float64 ломает Turbo (mel / LSTM). Патчи `peachbitch_float32`:  
  `…/chatterbox/tts_turbo.py` и `…/s3tokenizer/s3tokenizer.py` (backup `*.bak_peachbitch`).
- HF `snapshot_download` иногда падает по DNS — `getent ahostsv4` + `curl --resolve` (Turbo качали так).
- Turbo ignore: `CFG` / `exaggeration` (warning в логе нормален).
- Suite classic ≠ Turbo; MTL V3 = отдельная нода `ChatterBoxOfficial23LangEngineNode`.
- Qwen3 не сломан: `qwen-tts==0.1.1`, torch `2.10.0+cu128`, transformers `4.57.3` сохранены.

---

## Metalnode: Qwen3-TTS установлен (smoke 2026-08-07)

| Что | Путь / факт |
|-----|-------------|
| ComfyUI node pack | `/work/ComfyUI/custom_nodes/TTS-Audio-Suite` (v5.6.5, [TTS-Audio-Suite](https://github.com/diodiogod/TTS-Audio-Suite)) |
| Engine node | `Qwen3TTSEngineNode` (в object_info после рестарта) |
| Example workflow | `/work/ComfyUI/custom_nodes/TTS-Audio-Suite/example_workflows/Qwen3 integration + ASR.json` |
| Model | `Qwen/Qwen3-TTS-12Hz-1.7B-Base` → `/work/ComfyUI/models/TTS/qwen3_tts/Qwen3-TTS-12Hz-1.7B-Base` (~4.3 GB) |
| Python package | `qwen-tts==0.1.1` в `/work/ai/venv` (**обязателен**: патчит `ROPE_INIT_FUNCTIONS['default']` под transformers 5.x) |
| CLI regenerate | `/work/scripts/qwen3_tts_generate.py` |
| Smoke WAV | `/work/ComfyUI/input/tts_qwen3_line.wav` — **16 kHz mono PCM s16le**, ~2.08 s, ~66 KB |
| Demo ref (не Olga) | Suite `voices_examples/female/female_01.wav` (+ `.reference.txt`) |
| System | `sox` установлен (нужен qwen-tts / audio I/O) |

### Регенерация CLI

```bash
ssh -i "…/metalnode_id_ed25519 (2).txt" -p 22022 root@$METALNODE_HOST
/work/ai/venv/bin/python /work/scripts/qwen3_tts_generate.py \
  --text "I missed you so much. Come closer." \
  --ref-audio /work/ComfyUI/custom_nodes/TTS-Audio-Suite/voices_examples/female/female_01.wav \
  --out /work/ComfyUI/input/tts_qwen3_line.wav
```

Своя Olga: положи чистый 3–10 с EN WAV + транскрипт рядом как `voice_olga_ref.wav` / `voice_olga_ref.reference.txt` в `input/`, передай `--ref-audio` / `--ref-text`.

### ComfyUI

1. SSH tunnel: `-L 8188:localhost:8188` port **22022**
2. Нода **Qwen3-TTS Engine** (`Qwen3TTSEngineNode`) + Character Voices / TTS Text (Suite)
3. Модель: Base 1.7B из `models/TTS/qwen3_tts/…`
4. Выход привести к **16 kHz mono** перед MuseTalk (скрипт CLI уже пишет 16k)

### Gotchas

- **Bundled Suite `qwen_tts` alone** на transformers 5.3 падает: `KeyError: 'default'` в RoPE и конфликт `fix_mistral_regex`. Обход: **`pip install qwen-tts`** (официальный пакет регистрирует default RoPE). Для Suite-нод импорт официального пакета должен быть доступен в venv.
- В `qwen3_tts_model.py` Suite убран `fix_mistral_regex=True` (маркер `peachbitch_fix_mistral`); backup: `…/qwen3_tts_model.py.bak_peachbitch`.
- Suite `install.py` **не гоняли целиком** — ругается на отсутствующие deps других движков (ChatterBox/F5/Higgs/RVC). На Qwen3 smoke это не мешает.
- DNS к HF/GitHub иногда тупит — `getent ahostsv4` + `curl --resolve` / HF token ускоряют download.
- VRAM: Base 1.7B bf16 ~5–6 GB рядом с idle Comfy; MuseTalk лучше по очереди.
- **Ref Olga ещё нет** — текущий sample = clone с demo female_01, не персонаж.

### Next

1. Реальный `voice_olga_ref.wav` (3–10 с) → перегенерить Qwen3 + Chatterbox Turbo  
2. MuseTalk A/B: `tts_qwen3_line.wav` vs `tts_chatter_line.wav` vs Piper  
3. Опционально CosyVoice3 / CustomVoice; позже MTL V3 для RU  

---

## Сводная таблица кандидатов (6 шт.)

| Модель | Качество «живости» | Клон | ComfyUI | VRAM (ориентир) | Установка | Языки | Эмоции / стиль | Лицензия (коммерция) | Заметки для диалога/lipsync |
|--------|-------------------|------|---------|-----------------|-----------|-------|----------------|----------------------|------------------------------|
| **Qwen3-TTS** 0.6B/1.7B | ★★★★★ | Да (~3 с) | Да — [TTS-Audio-Suite](https://github.com/diodiogod/TTS-Audio-Suite) | ~4–8 GB | Средняя | 10+ (EN/ZH/JA/…) | Instruct / VoiceDesign; в Base-clone instruct часто **взаимоисключён** | **Apache 2.0** ✅ | Стриминг ~97 ms; для MuseTalk → WAV 16 kHz mono |
| **CosyVoice 3** 0.5B | ★★★★★ | Да (zero-shot, cross-lingual) | Да — Suite | ~4–6 GB (+ ~5 GB веса) | Средняя | 9 + диалекты ZH | Instruct + паралингвистика; эмоция часто **из ref** | **Apache 2.0** ✅ | Стабильный клон персонажа; хорош как «голос Olga» на EN→RU позже |
| **Chatterbox** Turbo/MTL | ★★★★☆–★★★★★ | Да (~7–10 с) | Да — Suite (исторически ядро) | ~6–8 GB | Лёгкая–средняя | EN / 23 (MTL) | Exaggeration; Turbo: `[laugh]` и т.п. | **MIT** ✅ | Отличный EN-диалог; MTL ≠ Turbo (нельзя всё в одном варианте) |
| **IndexTTS-2** ~1.5B | ★★★★☆ | Да | Да — Suite | ~6–10 GB | Средняя | EN/ZH (+JA) | 8 векторов эмоций, отдельный emotion ref | Apache + **ограничения** ⚠️ | **Duration control** = удобно под длину клипа MuseTalk |
| **F5-TTS** ~0.3B | ★★★★☆ | Да | Да — Suite | ~2–4 GB | Лёгкая | EN + несколько | Скорость / editing | Обычно open (проверить веса) | Быстрый backup; чуть слабее SOTA-2026 по просодии |
| **Fish Speech / OpenAudio S2** | ★★★★★ | Да | Частично (Suite: S2 Pro) | ~8–12 GB | Сложнее | 80+ (S2) | Inline emotion tags | **Research / часто NC** ❌/⚠️ | Качество топ, для **платного** peachbitch — риск; только PoC или коммерц. лицензия Fish |

### Кратко «почему не в shortlist»

| Модель | Почему отложили |
|--------|-----------------|
| GPT-SoVITS | Сильный клон, но тяжёлый пайплайн обучения/данных; избыточен для коротких реплик |
| Spark-TTS / MaskGCT | Норм, но слабее Qwen3/Cosy3 по бенчмаркам и экосистеме Comfy |
| Orpheus / Sesame CSM | Интересны, меньше зрелых нод / прод-практики |
| Kokoro | Быстрый, но **без клона** — голос персонажа не зафиксировать |
| XTTS-v2 | Когда-то стандарт; в 2026 уступает + лицензия неудобна |
| Bark / StyleTTS2 / Tortoise / MeloTTS | Роботизация / скорость / качество ниже современных |

---

## TOP-3: детали под наш пайплайн

### 1) Qwen3-TTS — первый кандидат

- Режимы: **Base** (clone), **CustomVoice** (пресеты), **VoiceDesign** (описание голоса текстом).
- Для персонажа «Olga»: Base + короткий чистый ref WAV (3–10 с, без музыки).
- Эмоции: instruct на CustomVoice/Design; при clone — либо выразительный ref, либо отдельный проход.
- VRAM на 5090 — не проблема; можно держать рядом с MuseTalk (по очереди, не обязательно одновременно).
- Репо: https://github.com/QwenLM/Qwen3-TTS

### 2) CosyVoice 3 — второй / multilingual-путь

- Fun-CosyVoice3-0.5B (есть RL-вариант в Suite).
- Лучший «один голос → много языков» без переобучения.
- Репо: https://github.com/FunAudioLLM/CosyVoice

### 3) Chatterbox — быстрый EN A/B

- Слепые сравнения Resemble: часто предпочитают ElevenLabs Turbo (вендорский тест — с скидкой, но качество реально высокое).
- MIT = спокойно для коммерции.
- Репо: https://github.com/resemble-ai/chatterbox

### IndexTTS-2 — опционально 4-й

Ставить **после** TOP-3, если нужна подгонка длительности реплики под клип. Перед продом — прочитать custom terms («нельзя улучшать другие AI-модели» и т.п.).

---

## ComfyUI: один пакет на все три

Рекомендуемая установка на Metalnode:

```text
custom_nodes/TTS-Audio-Suite   ← https://github.com/diodiogod/TTS-Audio-Suite
models/TTS/qwen3_tts/ …
models/TTS/CosyVoice/ …
models/TTS/chatterbox/ …
```

В Suite уже есть движки: Qwen3-TTS, CosyVoice3, Chatterbox, IndexTTS-2, F5-TTS.  
Альтернатива: отдельные ноды (CosyVoiceEngine и т.д.) — но Suite проще для A/B.

---

## MuseTalk: требования к аудио

| Параметр | Рекомендация |
|----------|--------------|
| Формат | **WAV PCM** |
| Sample rate | **16 kHz** (Whisper внутри MuseTalk) |
| Каналы | **mono** |
| Контент | Короткие реплики (1–2 предложения), без фоновой музыки в ref |

```bash
ffmpeg -y -i raw_tts.wav -ar 16000 -ac 1 -c:a pcm_s16le /work/ComfyUI/input/dialogue_natural.wav
```

Проблемы lipsync от TTS: слишком «шумный» клон, сильный reverb в ref, длинные паузы/hallucinated breaths — чистить ref и укорачивать текст.

---

## План теста на Metalnode (1–2 часа)

### 0. Подготовка

```bash
ssh -i "…/metalnode_id_ed25519 (2).txt" -p 22022 root@$METALNODE_HOST
# ComfyUI Manager → установить TTS-Audio-Suite
# или: cd /work/ComfyUI/custom_nodes && git clone https://github.com/diodiogod/TTS-Audio-Suite
# перезапуск ComfyUI; дождаться auto-download выбранного engine
```

Ref-голос: 5–10 с чистой женской EN речи → `/work/ComfyUI/input/voice_olga_ref.wav`  
Тестовая фраза (та же, что в диалог-PoC):

> I missed you so much. Come closer.

### 1. Сгенерировать 3 WAV

| # | Engine | Out |
|---|--------|-----|
| A | Qwen3-TTS Base 1.7B + ref | `input/tts_qwen3_line.wav` |
| B | CosyVoice3 + ref | `input/tts_cosy3_line.wav` |
| C | Chatterbox Turbo + ref | `input/tts_chatter_line.wav` ✅ smoke |

Нормализовать все в 16 kHz mono (команда выше).

### 2. MuseTalk A/B

Workflow `musetalk_dialogue_example` → тот же face-клип → по очереди A/B/C.  
Критерии (слух + губы):

1. Нет «радио/робота» (главный fail Piper)  
2. Естественные паузы / ударения  
3. Рот не «жуёт» на тишине  
4. Тембр похож на ref (если клон)

### 3. Выбор для прод-PoC

- Победитель → заменить Piper в `/work/scripts_tts_dialogue.sh` и в диалог-workflow.  
- Зафиксировать ref + seed/настройки в `docs/` (короткий чеклист).  
- Занести лицензию модели в `LICENSES.md`.

### CLI (установлено на Metalnode)

Предпочтительный путь — готовый скрипт (уже ресемплит в 16 kHz mono):

```bash
/work/ai/venv/bin/python /work/scripts/qwen3_tts_generate.py \
  --model /work/ComfyUI/models/TTS/qwen3_tts/Qwen3-TTS-12Hz-1.7B-Base \
  --text "I missed you so much. Come closer." \
  --ref-audio /work/ComfyUI/input/voice_olga_ref.wav \
  --out /work/ComfyUI/input/tts_qwen3_line.wav
```

Рядом с ref желателен файл `*.reference.txt` с транскриптом клипа (скрипт подхватит сам).
---

## Связь с остальным стеком

```
сценарий.dialogue
  → Qwen3 / Cosy3 / Chatterbox  (вместо Piper)
  → WAV 16k mono
  → MuseTalk (лицо)
  → mux audio+video
```

Отдельно от Wan Remix / RIFE / MMAudio SFX.

См. также: [`DIALOGUE-TEST.md`](./DIALOGUE-TEST.md) (текущий Piper→MuseTalk PoC).

---

## Источники (август 2026)

- [Qwen3-TTS](https://github.com/QwenLM/Qwen3-TTS) · [CosyVoice](https://github.com/FunAudioLLM/CosyVoice) · [Chatterbox](https://github.com/resemble-ai/chatterbox)
- [TTS-Audio-Suite (ComfyUI)](https://github.com/diodiogod/TTS-Audio-Suite)
- Сравнения: [Neosophie TTS 2026](https://neosophie.com/en/blog/20260317-tts), [OCDevel open TTS](https://ocdevel.com/blog/20250720-tts), бенчмарки Seed-TTS-Eval / MOSS-TTS tables
