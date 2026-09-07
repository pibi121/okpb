# peachbitch — план и отложенные задачи

Обновлено: **2026-08-13**  
**Прод-связка (актуальная, 2026-08-13):**  
**Krea 2** (T2I + instruction-edit, character/NSFW LoRA) → **MiniMax H3** (I2V / речь / диалоги) → **монтаж** (`AutoEditWorkbench`) → **BGM** (ACE-Step) + **микс** (`DJ_VideoAudioMixer`).  
Flux / Wan Remix остаются как проверенный запасной контур, не как основной still/video. SeedVR2 **не** в hot path (портит лицо).

Не обсуждать в рабочих чатах лицензии/юридику по этой связке — сначала гоняем качество и продукт, решения по базе потом.

---

## ✅ Подтверждённая база (протестировано за неделю, зафиксировано 2026-08-11)

Пользователь подтвердил как успешное — **берём за основу продукта**:

| # | Что | Статус | Детали |
|---|-----|--------|--------|
| 1 | **Flux + LoRA + пресеты промптов** (позы + стиль картинки) | ✅ | Шаблоны поз/стиля из `PROMPT_GUIDE_FLUX_MINIMAX.md`; артефакты анатомии фиксятся через img2img-from-reference — [`ANATOMY-FIX-RESEARCH.md`](ANATOMY-FIX-RESEARCH.md) |
| 2 | **MiniMax H3 — I2V и R2V** (референсы пока как 2 кадра с переходом от одного к другому) | ✅ | [`MINIMAX-H3.md`](MINIMAX-H3.md) |
| 3 | **Генератор музыки** (ACE-Step 1.5 Turbo, instrumental, разные стили) | ✅ | [`MONTAGE-MUSIC.md`](MONTAGE-MUSIC.md) § Тест 2 |
| 4 | **Монтаж видео** (автосклейка клипов, `AutoEditWorkbench`, + обрезка первых секунд `trim_start`) | ✅ | [`MONTAGE-MUSIC.md`](MONTAGE-MUSIC.md) § Тест 1 |
| 5 | **Склейка итогового видео + музыки** (`DJ_VideoAudioMixer`, тихий BGM-фон) | ✅ | [`MONTAGE-MUSIC.md`](MONTAGE-MUSIC.md) § Тест 3 |

Это — рабочий базовый пайплайн от фото/промпта до готового ролика со звуком и музыкой. Дальнейшие доработки (этапы D–G ниже) идут **поверх** этой базы, не заменяя её.

### Prompt LLM (R&D, 2026-08-12)

| # | Что | Статус | Детали |
|---|-----|--------|--------|
| 6 | **Локальный uncensored LLM** для сценариев / склейки шаблонов с запросом юзера | ✅ на тестах | **Gemma 4 31B Heretic** Q5_K_M через Ollama на той же 5090 (~52 tok/s). NSFW без отказов + merge pose/style/character. Пока timeshare с Comfy; в платформе — отдельная GPU. См. [`LLM-PROMPT.md`](LLM-PROMPT.md) |

### Krea 2 still + edit (прод-выбор, 2026-08-13)

| # | Что | Статус | Детали |
|---|-----|--------|--------|
| 7 | **Krea 2 Turbo** T2I + character/NSFW LoRA | ✅ **основной still** | Стабильнее Flux на наших позах. NSFW **KNPV4.1** + **`olh_person_krea2`**. Workflow: `krea2_t2i_olh_nsfw_READY`. См. [`KREA2.md`](KREA2.md) |
| 8 | **Krea 2 Identity Edit** (инструкция текстом) | ✅ **перед I2V** | `krea2_edit_READY` + LoRA `krea2_identity_edit_v1_2`. Правка кадра сцены до оживления. |

### Рабочие workflow (база 2026-08-07)

| Роль | Локально | На Comfy (Metalnode) |
|------|----------|----------------------|
| Still: LoRA + Flux | `peachbitch/workflows/still-lora-flux.json` (= `Лора+Флакс.json`) | `user/default/workflows/still-lora-flux.json` |
| Video: Remix + RIFE | `peachbitch/workflows/video-remix-rife.json` (= `Wan-Remix-RIFE.json`) | `user/default/workflows/video-remix-rife.json` |

Исходники пользователя: `Downloads/Лора+Флакс (1).json`, `Downloads/Unsaved Workflow (3).json`.

---

## Стек сейчас (факт на Metalnode)

| Слой | Что |
|------|-----|
| Still + edit | **Krea 2** Turbo + `olh_person_krea2` + KNPV4.1; edit = Identity Edit LoRA |
| Trigger | `olh_person` |
| Промпты | Gemma4-heretic / Prompt Composer (вшить в платформу) — [`LLM-PROMPT.md`](LLM-PROMPT.md) |
| Video + речь | **MiniMax H3** (I2V / R2V / native AV, диалоги) — [`MINIMAX-H3.md`](MINIMAX-H3.md) |
| Музыка + микс | **ACE-Step** BGM + **AutoEditWorkbench** + **DJ_VideoAudioMixer** — **вшить в прод** ([`MONTAGE-MUSIC.md`](MONTAGE-MUSIC.md)) |
| Запасной контур | Flux still + Wan Remix + RIFE (проверено ранее, не основной путь) |
| SSH | key `(7).txt`, port **22022**, tunnel `8188` (+ `8080`/`8090` для LLM) |
| Отложено | SeedVR2 в hot path (портит лицо) |

---

## Продукт: закрытая бета → режим Peach (зафиксировано 2026-08-13)

### Доступ
- Регистрацию **не** делаем в v1.
- Закрытая бета по **приглашениям** (invite / allowlist).
- NSFW age/consent gate на входе.

### Два режима продукта

| Режим | Когда | UX |
|-------|--------|-----|
| **Peach** | Бета и первая версия | Лайт-генератор: просто, пресеты, короткий сюжет → сценарий |
| **BITCH** | После беты + отработки Peach | Глубокое погружение: блок-схема, детали, тонкие настройки (как планировали раньше) |

В бете в кабинете доступен **только Peach**. BITCH — вкладка/режим позже или скрыт.

### Кабинет Peach — три зоны

1. **Фото**  
   - Шаблоны или свой запрос, разные размеры.  
   - Персонаж: Lookbook only / Lookbook+LoRA / без персонажа.  
   - Режим **«только фото»** → позже кнопка **«Оживить»** (в MiniMax).

2. **Видео**  
   - **1 клип:** короткий запрос → фото (Krea) → видео (MiniMax).  
   - **Мини-фильм:** запрос → LLM раскладывает сценарий (напр. 6×5с) → фото → видео → склейка → музыка по желанию → монтаж.  
   - **Пресеты:** готовые отработанные наборы сцен/ракурсов; меняются персонаж и детали. Пресеты добавляем вручную (потом — пользовательские).  
   - Не блок-схема: wizard «написал → подтвердил сценарий → сгенерировал».

3. **Соцсети**  
   - Вкладка-заглушка под короткие вертикальные танцевальные пресеты.  
   - **Не разрабатываем функционал сейчас** — только место в IA.

### Обязательный UX вокруг кадров
- **Галерея** результатов (история, скачать, повторить, оживить).  
- На **каждом фото**: иконка **карандаша** → поле инструкции → **Krea Identity Edit**; рядом **перегенерация**.  
- Edit — часть этапа фото-сцен **до** оживления.

### Персонажи: LoRA + Lookbook

**Lookbook** (продуктовое имя; в коде `lookbook` / `appearance_profile`) — структурированная анкета внешности, не свободный текст.

Поток:
1. Юзер загружает фото (для LoRA и/или для разбора внешности).  
2. LLM/VLM смотрит фото → **выбирает варианты из enum-параметров** (волосы, лицо, глаза, губы, подбородок, тело, грудь, кожа, вайб…).  
3. Юзер правит кликами.  
4. Можно пользоваться **сразу без LoRA** (тип внешности в промпте; лицо может плавать).  
5. Параллельно/потом крутится **трейн LoRA** с прогрессом в реальном времени (upload → Lookbook → train → ready).  
6. Когда LoRA готова: в промпт идут **trigger + Lookbook** (лицо держит LoRA; тело/детали — анкета).

Статусы персонажа в UI:
- `Lookbook ready` — можно генерить  
- `LoRA training…` — прогресс  
- `LoRA ready` — лицо зафиксировано  

При включённой LoRA поля «лицо» в Lookbook можно приглушать (чтобы не спорить с весами); тело/стиль остаются активными.

Мужской канон (bald muscular и т.п.) — отдельный короткий Lookbook/пресет для duo.

### Прод-пайплайн Peach (технически)

```
[invite] → кабинет Peach
  Фото:   Lookbook ± LoRA → PromptComposer → Krea T2I → (✎ edit) → Gallery
  1 клип: still → MiniMax I2V → Gallery
  Фильм:  user plot → LLM scenario (N битов) → ×(Krea → edit? → MiniMax) → AutoEdit → ACE-Step? → DJ mix → Gallery
  Соцсети: stub
```

BITCH позже = тот же стек моделей + граф/блок-схема и расширенные настройки.

---

## Этап D — локальные базовые промпты (сценарий + пресет действия)

**Цель:** финальный motion/still-промпт = **то, что написал пользователь в сценарии** + **базовый шаблон действия** (механика, камера, свет, тело), без облачных цензоров.

### Архитектура сборки промпта

```
[карточка персонажа] + [пресет действия] + [текст сценария юзера] + [камера/длина клипа]
        → локальный LLM/VLM (enhancer)
        → prompt для still / prompt для Wan I2V
```

### Локальные решения (приоритет)

1. **Qwen3-VL / QwenVL в Comfy** (локально на той же 5090 или маленькой CPU/GGUF ноде)
   - Картинка still → описание позы/сцены для I2V.
   - Форк с пресетами **Wan 2.2 I2V** (секундная таймлайн-структура) — удобно стыковать с Remix.
   - Для NSFW без отказов — abliterated / uncensored варианты QwenVL.
2. **Ollama / llama.cpp + Prompt Manager** (вне Comfy, в бэке peachbitch)
   - Сервис `PromptComposer`: system-prompt с шаблоном 5 блоков (сеттинг → тела/механика → лицо/дыхание → камера → свет/детали).
   - Вход: `action_id` + free text юзера + character card JSON.
   - Выход: EN motion-prompt под Remix + короткий still-prompt.
3. **Библиотека пресетов действий (без LLM на первых шагах)**
   - YAML/JSON: `missionary`, `cowgirl`, `blowjob`, … → готовый base prompt + negative + recommended length/resolution.
   - LLM только дополняет/переписывает поверх пресета — дешевле и стабильнее.

### Продуктовые фичи

- [ ] Каталог **action presets** (10–20 базовых действий) с base/negative.
- [ ] Поле сценария пользователя (свободный текст) → merge с пресетом.
- [ ] Опционально: «улучшить промпт» через локальный Qwen (кнопка, не обязательно каждый раз).
- [ ] Промпт всегда сохранять в метаданных джоба (replay / A-B).

Шаблон блоков (из практики Remix): сеттинг → субъекты+механика движения → лицо/взгляд/дыхание → камера → свет/кожа.

---

## Этап E — липсинг и озвучка (Remix этого не делает)

Remix I2V = **немое** видео движения. Диалоги и SFX — **отдельные стадии после** (или параллельные ветки), не ломают основной I2V.

### E1. Липсинг / диалог персонажей

| Подход | Когда | Как |
|--------|--------|-----|
| **A. Post lipsync на уже готовый клип** | Короткие реплики поверх I2V | LivePortrait / MuseTalk / Wav2Lip-подобные ноды: video + TTS audio → рот |
| **B. Audio-driven генерация (Wan S2V / InfiniteTalk)** | Нужен сильный talk / singing | Отдельный workflow: still + audio → `WanSoundImageToVideo` / InfiniteTalk (PainterAI2V и т.п.) |
| **C. Гибрид** | Лучшее качество продукта | Remix на тело/действие → если есть речь: перегнать лицо через lipsync-pass **или** отдельный talking-shot S2V |

**Решение для платформы (черновик):**
1. Основной контент сцены → **Remix I2V** (тело, камера, действие).
2. Если в сценарии есть `dialogue` / `voiceover` → сгенерировать речь (**TTS локально**: Piper / CosyVoice / XTTS) → **lipsync pass** на клип или отдельный talking-shot.
3. Не смешивать S2V и Remix в одном прогоне без нужды — разные модели, разный VRAM-бюджет.

### E2. Foley / стоны / хлюпы / шлепки

| Подход | Инструмент | Заметка |
|--------|------------|---------|
| **Video→Audio (предпочтительно)** | **MMAudio** (`kijai/ComfyUI-MMAudio`) | Смотрит видео, генерит синхронный foley; prompt + negative («no music», «no speech» или наоборот) |
| Библиотека SFX + таймкоды | Каталог wav + триггеры из сценария (`slap@1.2s`) | Предсказуемо, дёшево, ручная полировка |
| TTS «вокал» отдельно | Короткий moan/breath bed | Слоить с MMAudio, не ждать от V2A идеальной речи |

**Пайплайн звука:**
```
silent Remix mp4 → MMAudio (foley) → [optional TTS/lipsync layer] → mux (ffmpeg)
```

Критерий Go: 5-сек клип с узнаваемым действием + слышные синхронные SFX без чужой музыки.

---

## Этап F — лицо: safety net + описание персонажа при трейне

### F1. Когда LoRA «плывёт» — система безопасности

Цепочка (включается по флагу / авто-детект similarity):

1. **Детект:** InsightFace / face embedding vs референс LoRA → score ниже порога = fail.
2. **Face restore / swap pass:** ReActor (или аналог) + face restore (CodeFormer/GFPGAN) покадрово на клип; референс = лучший still с LoRA.
3. **Сглаживание мерцания:** RIFE 2× после swap (опционально).
4. **Повтор still→I2V** с другим seed / короче length / меньше motion в промпте — если score критически низкий.

Не ставить face-swap на каждый клип по умолчанию (дорого + артефакты) — только **fallback** или «premium face lock».

### F2. Lookbook при персонаже / трейне LoRA (продуктовая фича)

См. раздел **«Персонажи: LoRA + Lookbook»** выше. Кратко:

| Поле (enum, не free text) | Пример вариантов |
|------|--------|
| trigger | `olh_person` (когда LoRA ready) |
| hair | length, color, style |
| face | shape, jaw, nose, lips |
| eyes | color, shape |
| body | height feel, build, breast/hip size, skin tone |
| marks | tattoos, moles, piercings |
| age_feel / vibe | adult presentation only |
| negative_traits | what NOT to drift into |

**Использование:**
- Капшены датасета при трейне: `trigger, {lookbook phrases}, …`
- Still/I2V: Lookbook → EN-фрагменты в PromptComposer; с LoRA — + trigger
- UI: редактируемо после трейна без retrain; полный retrain — опция
- Без LoRA: генерация по одной анкете (быстрый старт)

### F3. Трейн LoRA (платформа)

- [ ] Форма character card → автогенерация `.txt` капшенов.
- [ ] Рекомендации датасета: 15–30 фото, разные ракурсы, лицо крупно + 1–2 full body.
- [ ] Отдельные LoRA под still-базу (Z-Image / Klein); **не** ждать, что still-LoRA починит Wan — лицо держим still + fallback F1.
- [ ] Позже: опциональный Wan-specific face LoRA / IPAdapter — отдельный R&D.

---

## Этап G — усиление качества (не ломает основной флоу)

Всё ниже — **post / parallel stages**. Основной путь остаётся: still → Remix I2V.

### G1. Плавнось движения (аналог Topaz Astra по смыслу)

| Инструмент | Роль | Когда |
|------------|------|--------|
| **RIFE / Practical-RIFE** (Comfy VFI) | ×2 / ×4 интерполяция кадров | После I2V: 16fps→32/64, меньше дёрганья |
| Генерация сразу длиннее + меньше motion | Меньше «мыла» лица | length ~49–81, спокойная камера |
| SeedVR2 Video Upscaler *(уже на Metalnode)* | Апскейл + детализация клипа | После I2V / после RIFE |

Рекомендуемый хвост качества:
```
Remix I2V → (opt face lock) → RIFE 2x → SeedVR2 upscale → MMAudio → mux
```

### G2. Фото / still до видео

| Инструмент | Роль |
|------------|------|
| Character LoRA + identity card в промпте | likeness |
| 2-pass still: LoRA кадр → лёгкий img2img / refine без/слабо LoRA | кожа/текстура |
| Face detailer (Impact) на still | глаза/рот до I2V |
| SeedVR2 / апскейл still перед I2V | больше пикселей лица → Remix лучше держит |
| **img2img из реального фото-референса** (VAEEncode+denoise, без ControlNet — не совместим с Klein 9B, проверено) + hand-detailer + pose-LoRA | Фикс артефактов анатомии на сложных переплетённых позах — подтверждено живым тестом на сервере, готовый воркфлоу + фото до/после — см. [`ANATOMY-FIX-RESEARCH.md`](ANATOMY-FIX-RESEARCH.md) |

### G3. Цвет / картинка / физика

| Инструмент | Роль |
|------------|------|
| Color match / wavelet color fix (часто в SeedVR2) | стабильный тон после апскейла |
| Film grain / mild sharpen post (лёгкий) | «телефонный» look без мыла |
| Подробная механика в промпте (не «having sex», а конкретные векторы движения) | меньше ломаных конечностей на Remix |
| Reroll 2–4 seed на шоты | норма пайплайна, не «ошибка» |
| Короткие шоты + stitch | лицо стабильнее, чем один длинный клип |

### G4. Что пока не мешать в hot path

- Не вешать десяток style LoRA на Remix одновременно с identity.
- Не раздувать шаги Remix сверх ~8–16 суммарно.
- Не гонять 1920×1088 на первом прогоне — старт **832×480 / 1280×720**, апскейл хвостом.
- S2V/InfiniteTalk — отдельный продукт-режим «talk», не замена Remix action.

---

## План дальше (порядок) — под бету Peach

### Приоритет беты
1. Invite / allowlist + NSFW gate (без полноценной регистрации).
2. Кабинет **только Peach**: вкладки Фото / Видео / Соцсети(stub) + **Галерея**.
3. **Lookbook** (схема enum + LLM заполнение с фото) + трейн LoRA с прогрессом.
4. Фото: Krea T2I ± LoRA + ✎ edit + regen; «только фото» → «Оживить».
5. Видео: 1 клип + мини-фильм (LLM-сценарий) + ручные пресеты; MiniMax + склейка + ACE-Step/микс.
6. Вшить PromptComposer в бэк (не Gradio-lab).
7. **BITCH (блок-схема)** — после беты.

### Этап C — проводка в peachbitch (Peach-first)
1. `MockProvider` → очередь воркера Metalnode/Comfy (Krea / MiniMax / music).
2. Персонажи: upload → Lookbook → opt LoRA train.
3. Пресеты сцен (JSON) + job metadata (промпты, персонаж, стадии).
4. Биллинг/кредиты по SKU из утверждённой экономики — [`ECONOMICS-APPROVED.md`](ECONOMICS-APPROVED.md) (2026-08-15).
5. GPU-инфра (HOSTKEY / RunPod / Vast, 10→100→1000) — [`GPU-INFRA.md`](GPU-INFRA.md).

### Этап D — промпты
1. Enum-схема Lookbook + EN-фрагменты.
2. 10+ action / film presets (YAML/JSON).
3. PromptComposer: Lookbook ± LoRA trigger + preset + user plot → still + I2V prompts.

### Этап E — звук
1. MiniMax native AV / диалоги в видео-пути.
2. ACE-Step + AutoEdit + DJ mixer в прод-джобе мини-фильма.
3. Отдельный lipsync/TTS fallback — по необходимости после беты.

### Этап F — лицо
1. Lookbook UI + капшены в train.
2. Face score + fallback на клип — после стабилизации Peach.

### Позже
- Режим **BITCH** (граф, тонкие настройки)
- Соцсети: вертикальные dance-пресеты
- Оплата / Google / Discord, дизайн-полировка

---

## Быстрый чеклист сессии (Metalnode)

1. SSH key `(7).txt`, port `:22022` → `:8188` (Comfy), опц. `:8080`/`:8090` (LLM)  
2. Still/edit: Krea + `olh_person_krea2` / `krea2_edit_READY`  
3. Video: MiniMax H3  
4. Music/stitch: ACE-Step + AutoEdit + DJ mixer  
5. Запасной контур: Flux / Remix — только если нужен A/B
