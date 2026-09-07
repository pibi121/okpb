# MiniMax H3 — локально в ComfyUI

Дата: **2026-08-08**

Подтверждено: MiniMax H3 действительно выложен в **открытых весах** и официально поддерживается в ComfyUI (родные ноды, без сторонних кастомных нод). Не облачное API — модель реально работает на нашей карте.

---

## Что за модель

Омни-модальная модель MiniMax: понимает текст/фото/видео/аудио одним контекстом, генерирует видео **со встроенным синхронным звуком** — голос, диалоги, SFX и музыка рождаются в одном проходе, а не накладываются потом отдельным TTS-слоем.

- **T2V** — с нуля по тексту
- **I2V** (fl2va) — из фото (+ текст с описанием движения/речи)
- **R2V** (ref2va) — из набора референсов (фото + видео + аудио) — годится для переноса голоса/стиля
- До 2K/24fps/~15 сек в облаке; локально (open weights) — до ~768p, это уже достаточно для диалоговых сцен

## Что сделано на Metalnode

1. **Обновлено ядро ComfyUI**: `0.18.1` → **`0.31.1`** (нужно ≥0.30.0 для нативной поддержки H3).
   - Кастомные ноды (WanVideoWrapper, MuseTalk-KJ, KJNodes и т.д.) — отдельные git-репозитории, ядро их не трогает. После обновления и перезапуска все загрузились **без ошибок**.
   - **Откат если что-то не так**: старый коммит сохранён в `/work/backups/comfyui_core_commit_before_h3.txt`, старые версии pip-пакетов — в `/work/backups/pip_freeze_before_h3.txt`.
     ```bash
     cd /work/ComfyUI
     git checkout $(cat /work/backups/comfyui_core_commit_before_h3.txt)
     /work/ai/venv/bin/pip install -r /work/backups/pip_freeze_before_h3.txt
     # затем убить tmux-сессию comfy, вотчдог поднимет заново
     ```
2. **Скачаны веса** (вариант `pruned_fp8_scaled` — компромисс размер/качество под 32 ГБ VRAM):

   | Файл | Размер | Путь |
   |---|---|---|
   | `minimax_h3_fl2va_pruned_fp8_scaled.safetensors` | 21 ГБ | `models/diffusion_models/` — I2V/T2V |
   | `minimax_h3_ref2va_pruned_fp8_scaled.safetensors` | 21 ГБ | `models/diffusion_models/` — R2V |
   | `qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors` | 15.7 ГБ | `models/text_encoders/` |
   | `minimax_h3_video_vae_fp16.safetensors` | 5.2 ГБ | `models/vae/` |
   | `minimax_h3_audio_vae_fp32.safetensors` | 0.6 ГБ | `models/vae/` |

   Итого ~63 ГБ на диске (диск: 1.4 ТБ свободно — норм).

3. **Ноды уже встроены** в ядро 0.31.1: `MiniMaxH3ImageToVideo`, `MiniMaxH3ReferenceToVideo`, `EmptyMiniMaxH3LatentAV` и т.д. Ничего доустанавливать не нужно.

## Готовые workflow

| Где | Файлы |
|---|---|
| ПК (Desktop) | `minimax_h3_i2v_READY.json`, `minimax_h3_t2v_READY.json`, `minimax_h3_r2v_READY.json` |
| Сервер Comfy | Workflows (боковая панель) → **`minimax_h3_i2v_READY`** / `minimax_h3_t2v_READY` / `minimax_h3_r2v_READY` |

В I2V-варианте уже проставлено:
- **Load Image**: `Flux2_upscale_00009_.png` (портрет с сервера — замени на своё фото)
- **Prompt**: тест диалога — крупный план, женщина смотрит в камеру и говорит «Привет! Я так рада тебя видеть.» с липсинком, чистый голос без музыки
- Все модели уже выбраны в дропдаунах (`pruned_fp8_scaled`, `nvfp4_awq`, VAE)

## Тест в Comfy

1. http://127.0.0.1:8188 → **Ctrl+F5** (чтобы точно подхватить новую версию 0.31.1)
2. **Workflows** → **`minimax_h3_i2v_READY`** (или Load → файл с Desktop)
3. Проверь **Load Image** — можно поставить своё фото (лицо крупно, смотрит в камеру)
4. При желании поменяй текст в поле prompt (реплику в кавычках) и/или соотношение сторон в **Resolution Selector** (по умолчанию 1:1, для портрета можно выбрать вертикальное)
5. **Queue**. Первый прогон — модель большая (63 ГБ весов на диске грузится в VRAM/RAM), может занять несколько минут даже на 5090.
6. Результат — **SaveVideo** нода, файл сохранится в `output/video/MiniMax_H3/...` и покажется прямо в Comfy.

### Ожидай

- Видео ~5 сек (можно увеличить `duration` виджетом, но модель "квантуется" по сетке ~17 кадров при 24fps)
- Родной синхронный звук — голос из диалога прямо в сгенерированном видео, без отдельного TTS
- VRAM ~20-25 ГБ пиковая, offload остального в RAM (свободно 61 ГБ — с запасом)

### Если что-то пошло не так

- Красная нода / "model not found" → Ctrl+F5, проверь, что файлы лежат ровно с этими именами в нужных папках (см. таблицу выше)
- OOM (VRAM) → уменьши `duration` или разрешение в Resolution Selector
- Долго/зависло на первом прогоне → это нормально для первой загрузки такой большой модели с диска; смотри лог: `tmux capture-pane -t comfy -p -S -200` на сервере

## R2V — тот же тембр голоса между клипами (только MiniMax)

Звук всегда генерирует сам H3. Чтобы в следующих роликах тембр был похож на уже удачный клип — **не сторонний TTS**, а референс-аудио обратно в R2V.

### Пошагово

1. Сгенерируй первый клип в **I2V/T2V** (`minimax_h3_i2v_READY`), где персонаж говорит. Сохрани mp4.
2. Вырежи 3–15 с **чистой речи** (без музыки/шума) в WAV:
   ```bash
   ffmpeg -i clip.mp4 -vn -ac 1 -ar 44100 -t 8 /work/ComfyUI/input/voice_refs/voice_ref.wav
   ```
   Папка `input/voice_refs/` уже создана на сервере.
3. Открой **`minimax_h3_r2v_READY`**. Чекпоинт должен быть **`minimax_h3_ref2va_…`** (не fl2va).
4. Подключи:
   - `ref_image_0` — фото персонажа
   - `ref_audio_0` ← `LoadAudio` → `voice_refs/voice_ref.wav`  
     (альтернатива: `ref_video_0` + `ref_video_audio_0` = сам эталонный клип)
5. В prompt явно:
   - `Use <Audio 1> as the speaker voice timbre.`
   - сцена + **новая реплика** в кавычках
6. Queue → новый клип со своим (MiniMax) звуком, но тембр ближе к референсу.

### Ожидания

- Это **похожий** тембр/манера, не жёсткий voice-ID клон.
- Один персонаж = один стабильный `voice_ref.wav` из лучшего клипа.
- Второй голос = отдельный ref-файл.
- Если нужна именно новая фраза тем же голосом — пиши «use as voice timbre», а не «play this audio exactly».

## Связь с остальным пайплайном

```
Фото (Flux) ──┬── T2V/I2V H3 (голос+липсинк по тексту) ──► клип
              └── R2V H3 + ref_audio из предыдущего H3-клипа ──► новый клип, похожий тембр

Склейка шотов + тихий BGM: см. MONTAGE-MUSIC.md (ACE-Step + DJ mixer; звук ролика всё ещё MiniMax)
```

См. также: [`MONTAGE-MUSIC.md`](./MONTAGE-MUSIC.md), [`PHOTO-TALKINGHEAD.md`](./PHOTO-TALKINGHEAD.md), [`DIALOGUE-TEST.md`](./DIALOGUE-TEST.md).
