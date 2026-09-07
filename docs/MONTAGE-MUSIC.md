# Автомонтаж + фоновая музыка (Metalnode)

Дата: **2026-08-11**

Стек для двух задач: склейка шотов и тихий instrumental BGM поверх клипа (звук видео — от MiniMax, без сторонних TTS).

SSH (актуально):  
`ssh -i "metalnode_id_ed25519 (5).txt" -L 8188:localhost:8188 root@$METALNODE_HOST -p 22022`

**Важно:** Comfy стартует с `--use-pytorch-cross-attention` (Blackwell / sm_120 ломает xformers — SAM3, ACE-Step и др.). Флаг в `/work/bin/start-comfy.sh`. Если SAM3 падает с `memory_efficient_attention_forward`, перезапуск: `node scripts/fix-comfy-blackwell-attn.mjs`.

---

## Что установлено

| Задача | Инструмент | Статус |
|--------|------------|--------|
| Автосклейка папки клипов | **ComfyUI-Video-Workbench** → нода `AutoEditWorkbench` (патчена: + `trim_start`/`trim_start_sec`) | ✅ (`moviepy==1.0.3` — 2.x ломает `moviepy.editor`); сквозной queue-тест на реальных клипах из `stitch_inbox` прошёл без ошибок; A/B-тест обрезки старта подтверждён |
| Сохранение видео | **VideoHelperSuite** (уже было) | ✅ |
| Генерация музыки | **ACE-Step 1.5 Turbo AIO** (нативные ноды Comfy 0.31.1) | ✅ модель `checkpoints/ace_step_1.5_turbo_aio.safetensors` (~9.4 ГБ); smoke 8s → `output/audio/bgm_smoke_test_00001.flac` |
| Тихий BGM поверх | **DJ_VideoAudioMixer** (патчен: BGM работает с ОДНИМ видео, не только с двумя) | ✅ |
| Foley / SFX (не музыка) | **MMAudio** (уже было) | ✅ отдельно |

---

## Workflows (сервер + Desktop)

| Файл | Назначение |
|------|------------|
| `stitch_autoedit_READY` | Папка mp4 → один склеенный клип |
| `ace_step_bgm_READY` | Text → instrumental BGM (wav/flac) |
| `video_bgm_mix_READY` | Клип + BGM → финал с `bgm_volume≈0.2` |

Пути: `peachbitch/workflows/` и Comfy → Workflows на сервере.

---

## Тест 1 — автосклейка

1. Положи 2–3 клипа в `/work/ComfyUI/output/stitch_inbox/` (имена по порядку: `01.mp4`, `02.mp4`…).
2. Workflows → **`stitch_autoedit_READY`**.
3. В Auto-Edit Workbench проверь `directory_path`.
4. Queue → `output/Stitch/autoedit_….mp4`.

Для короткого теста: `limit_duration_sec = 10`.

**Обрезка первых секунд каждого клипа (`trim_start`)** — добавлено 2026-08-11:
- Галочка `trim_start` (по умолчанию **выключена** — ничего не режет).
- Поле `trim_start_sec` (по умолчанию `1.5`) — сколько секунд срезать **с начала каждого отдельного клипа** перед склейкой. Полезно, если в начале оживления фото есть артефакты первые 1–2 сек, которые потом пропадают.
- Если включена и клип короче `trim_start_sec` — этот клип не обрезается (лог-предупреждение), чтобы не потерять его целиком.
- Проверено A/B-тестом на 8 реальных клипах: без обрезки итог `59.79s`, с `trim_start_sec=1.5` итог `47.79s` (разница ровно `8×1.5=12.0s`) — работает точно как задумано.

**Если ComfyUI пишет «Неизвестный пакет / Missing node type: AutoEditWorkbench»** — это кэш браузера или ты открыл не тот адрес:
1. Убедись, что открыт именно `http://localhost:8188` через проброшенный SSH-туннель (порт в команде выше), а не локальный/старый Comfy.
2. Сделай хард-рефреш страницы: `Ctrl+Shift+R`.
3. Если не помогло — ComfyUI-Manager → «Fix node (reinstall)» на этой ноде, либо просто перезагрузи вкладку заново после закрытия.

Сам узел на сервере проверен и рабочий (см. таблицу выше).

---

## Тест 2 — сексуальная музыка в стилях

1. Workflows → **`ace_step_bgm_READY`**.
2. В **lyrics** оставь **`[inst]`** (без вокала).
3. Меняй **tags**, примеры:
   - `slow sensual R&B, soft bass, intimate bedroom, sparse drums, warm pads, erotic mood, quiet, instrumental`
   - `dark ambient trip-hop, low pulse, nightclub afterhours, no vocals`
   - `lo-fi chillwave, vinyl crackle, soft synths, late night romantic, instrumental`
   - `soft cinematic erotic underscore, sparse piano, breathy pads, very quiet`
4. Длительность: seconds в `EmptyAceStep1.5LatentAudio` **и** `duration` в TextEncode — одинаковые (например 30).
5. Queue → `output/audio/bgm_sensual_….flac/wav`.

**Фикс 2026-08-11:** в `ace_step_bgm_READY.json` в ноде `TextEncodeAceStepAudio1.5` в массиве `widgets_values` не хватало значения скрытого виджета «управление после генерации» (идёт сразу за `seed`, как в `KSampler`). Из-за этого все значения после seed сдвигались на 1 позицию → `bpm` попадал в `duration`, `duration` в `timesignature`, `timesignature` в `language`, `language` в `keyscale` → ошибки «Недопустимый ввод» именно на этих трёх combo-полях. Исправлено (добавлено `"randomize"` сразу после `seed`).

---

## Тест 3 — приглушённый фон на клип

1. Сначала сделай BGM (тест 2).
2. Workflows → **`video_bgm_mix_READY`**.
3. Узел «1) Клип» = **`VHS_LoadVideo`** — жми кнопку **choose video to upload**, грузишь свой файл (склейку/MiniMax-клип) прямо с компьютера.
4. Узел «2) BGM» = **`VHS_LoadAudio`** — сюда вставляешь ПОЛНЫЙ путь на сервере к сгенерированному треку (напр. `/work/ComfyUI/output/audio/bgm_sensual_00001_.flac`), т.к. музыка генерируется прямо на сервере и грузить её с компьютера не нужно.
5. В DJ mixer: `bgm_volume = 0.15–0.25`, `repeat_audio` если трек короче видео.
6. Queue → `output/Final/with_bgm_….mp4`.

Голос MiniMax остаётся основным; музыка только фон.

**Важно про загрузку файлов в ComfyUI (2026-08-11):** ноды `VHS_LoadVideo` / `LoadAudio` (с кнопкой upload) видят только файлы в папке `input/` — они НЕ показывают то, что лежит в `output/` (результаты генераций). Поэтому:
- Свой файл с компьютера → используй ноду с кнопкой **upload** (`VHS_LoadVideo`, `LoadAudio`) — она сама зальёт файл в `input/`.
- Файл, который уже сгенерирован НА СЕРВЕРЕ (BGM из ACE-Step, видео из MiniMax, склейка) → используй path-ноду (`VHS_LoadVideoPath` для видео, `VHS_LoadAudio` для аудио) и вставь туда полный путь текстом, например `/work/ComfyUI/output/audio/bgm_sensual_00001_.flac`.

**Баг-фикс `DJ_VideoAudioMixer` (2026-08-11) — «видео получалось без музыки»:**
- Причина: узел изначально написан для склейки ДВУХ видео с общим BGM. Если `images2`/`video_info2` не подключены (у нас всегда один клип на входе), функция сразу возвращала `images1, audio1` в первых строчках — **BGM полностью игнорировался**, даже если провод к `bgm` был подключён правильно.
- Патч (`custom_nodes/DJ_VideoAudioMixer/video_audio_mixer.py`, бэкап `.bak_nobgm`): если `images2` не задан, но `bgm` подключён — синтезируется пустое «второе видео» (0 кадров), и остальной код микширования (уже рассчитанный на 2 видео) корректно накладывает BGM под единственный клип.
- Проверено: mean_volume у результата поднялся с `-19.2 dB` (без музыки) до `-16.3 dB` (с музыкой), звуковые дорожки не идентичны (разные MD5) — музыка реально смешивается.

---

## Голос персонажа между клипами MiniMax (без сторонних TTS)

Только **H3 R2V**:

1. Из удачного клипа вырежи 3–15 с чистой речи → `input/voice_ref.wav`.
2. Workflow **`minimax_h3_r2v_READY`**, чекпоинт **ref2va**.
3. `ref_image_0` = фото, `ref_audio_0` = `voice_ref.wav`.
4. В промпте: `Use <Audio 1> as the speaker voice timbre.` + новая реплика.

Подробнее: [`MINIMAX-H3.md`](./MINIMAX-H3.md) § R2V voice ref.

---

## Цепочка дня

```
шоты MiniMax → stitch_inbox → stitch_autoedit_READY
                              ↓
ACE-Step BGM (instrumental) → video_bgm_mix_READY → final.mp4
```

См. также: [`AUDIO-TEST.md`](./AUDIO-TEST.md) (MMAudio foley), [`MINIMAX-H3.md`](./MINIMAX-H3.md).
