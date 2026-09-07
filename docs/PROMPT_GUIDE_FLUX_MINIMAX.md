# Инструкция по написанию промптов: Flux Klein (SNOFS) + Minimax H3

Документ для ИИ и людей. Цель — стабильные **фото 18+** (Flux.2 Klein / SNOFS + character LoRA) и **видео** (Minimax H3 I2VA) по референс-кадру.

Язык промптов для генерации: **английский**.  
Комментарии и структура документа: русский.

---

## 0. Стек и роли

| Этап | Модель | Задача |
|------|--------|--------|
| Фото | **Flux.2 Klein + SNOFS** (+ LoRA персонажа, напр. `olh_person`) | Still, позы, свет, локация |
| Видео | **Minimax H3 I2VA** | Оживление still: движение, темп, звук |

**SNOFS** = Sex, Nudes, and Other Fun Stuff (NSFW-base под Klein). Явный adult-контент допустим напрямую.

**Важно:** у Klein **нет отдельного negative prompt**. Всё — в одном текстовом поле.

---

## 1. Flux Klein — как писать (обязательные правила)

### 1.1 Формат

1. **Связный prose** (1–3 коротких предложения / один абзац), не SD-теги через запятую.
2. Длина: **~40–100 слов**. Меньше 30 — мало контроля. Больше 150–200 — часто ломает анатомию и плодит лишних людей.
3. Порядок якорей:
   1. **Стиль камеры / свет / качество**
   2. **Локация**
   3. **Кто** (trigger LoRA + мужчина)
   4. **Поза и действие** (простая геометрия)
   5. **1–2 телесных якоря** (что видно, откуда растёт член, куда смотрит)
   6. Финал: `Only two people.`

### 1.2 Что усиливать словами (вместо весов)

Klein **не использует** `(word:1.3)`.  
Вместо этого: `clearly`, `fully`, `sharp`, `continuous from his body`, `filling the frame`, `locked`, `aggressive`, `high tempo`.

### 1.3 Character LoRA

- Триггер (`olh_person`) — **в первых 5–15 словах** блока про женщину или в начале сцены.
- Не дублировать противоречивые описания лица, если LoRA уже задаёт внешность.
- Мужчина — **один стабильный шаблон** на весь пак:  
  `bald muscular adult man` (или ваш фиксированный канон).

### 1.4 Анатомия и «только двое» — правильный способ

**Можно (коротко, позитивно):**
- `Only two people.`
- `his thick cock comes straight from his body`
- `Male pelvis and cock are one continuous body`
- `she bent forward standing on the floor`
- `man is standing behind her`
- `camera high looking down`
- `empty dark bedroom, nothing else in the room`

**Нельзя (ломает Klein — проверено на практике):**
- Длинные списки: `no extra limbs, no fused bodies, four arms twenty fingers, must not, what must not be`
- Каталог анти-поз: `NOT reverse cowgirl, no second woman, no third man, no floating cock...` (модель цепляется за слова и **рисует** их)
- Сверхдлинные «anatomy lock» абзацы на 100+ слов запретов

**Правило:** описывай **что есть в кадре**, а не энциклопедию того, чего нет.  
Один короткий финал `Only two people.` — достаточно. Для пустоты фона: `empty room`, `nothing else in the room`.

### 1.5 Член / пенетрация (частый баг)

| Баг | Почему | Фикс |
|-----|--------|------|
| Член «торчит из неё» / из ноги / отдельный орган | В кадре только pussy+cock без мужского тела | Всегда кусок **his hips / lower belly / pelvis** + `cock comes from his body` / `continuous body` |
| Ultra-macro genitals only | Klein теряет владельца органа | Чуть шире кроп **или** side/3/4 / high angle с тазом |
| Reverse cowgirl вместо standing doggy POV | Не ясна гравитация | `POV looking down from a standing man` + `she bent forward standing on the floor` + `man standing behind her` |

### 1.6 Стиль / камера / свет (пресеты)

Один пресет = один абзац. **Не смешивать 2–3 стиля** в одном промпте.

Шаблон стиля:
```
[camera aesthetic], [lighting], [color], [lens], [DOF/quality notes]. [scene content]. Only two people.
```

Примеры осей (менять по одной):
- Clean studio softbox / warm tungsten lamp / harsh direct flash / window daylight
- Hyper skin texture / phone snapshot noise / VHS soft low-res / teal-orange cinema / neon magenta-cyan / disposable film grain
- Lens: 26mm phone, 32mm plastic, 35mm, 50mm f/2, 85mm f/2.8, 100mm detail
- Quality: sharp commercial vs optically soft vs heavy grain vs mild blur

**Disposable film:** если не нужны засветы по краям — **не** писать `light leak`; явно можно: `no light leak, no glowing edges` (коротко, 1 раз).

### 1.7 Склейка: стиль + поза + локация

Порядок:
1. Стиль/камера  
2. Локация  
3. Поза/действие + персонажи  
4. `Only two people.`

**Пример структуры:**
```
[STYLE: flash/neon/film...]. [LOCATION: dark office at night...]. [POSE: olh_person ... man ... action]. Only two people.
```

---

## 2. Flux — ШАБЛОНЫ

### 2.1 Универсальный шаблон фото

```
[Camera/style/light/lens/quality]. [Location]. olh_person petite young woman [nude + pose]. [bald muscular man pose/action]. [1–2 anatomy anchors]. Only two people.
```

### 2.2 Standing doggy SIDE (look back) — не POV

Боковой / 3/4 ракурс. Не путать с POV сверху.

```
Photorealistic side view at night, warm lamp. olh_person petite woman bent forward standing doggy on the floor, man standing behind her, his thick cock inside her pussy from behind, she looks back over her shoulder. Bodies from the side, not first-person POV. Empty dark room. Only two people.
```

### 2.3 Standing doggy SIDE (face away) — не POV

```
Photorealistic side view at night, warm lamp. olh_person petite woman bent forward standing doggy on the floor, man standing behind her, his thick cock inside her pussy from behind, face turned away. Bodies from the side, not first-person POV. Empty dark room. Only two people.
```

### 2.3a Standing doggy POV (look back) — LOCKED (формула как у рабочего BJ POV)

Ключ: `First-person POV looking down from above from a standing man` + `ass toward camera` + `cock comes straight from his body`.

```
Photorealistic First-person POV looking down from above from a standing man at night, warm lamp. olh_person petite woman bent forward standing doggy on the floor, ass toward camera filling the frame, his thick cock comes straight from his body into her pussy from behind, continuous male pelvis and cock. She turns her head and looks back over her shoulder up into the camera. Empty dark room. Only two people.
```

### 2.3b Standing doggy POV (face away) — LOCKED

```
Photorealistic First-person POV looking down from above from a standing man at night, warm lamp. olh_person petite woman bent forward standing doggy on the floor, ass toward camera filling the frame, his thick cock comes straight from his body into her pussy from behind, continuous male pelvis and cock. Face turned away, not looking at camera. Empty dark room. Only two people.
```

### 2.3c Blowjob POV (cock in mouth) — тестовый LOCK

Рабочий якорь с минета: `First-person POV looking down from above` + kneeling + cock in mouth.

```
Photorealistic First-person POV looking down from above. olh_person petite woman kneeling nude on the floor, taking his thick cock deep in her mouth, looking up submissively into the camera. His hips and cock enter from the top of frame, cock comes straight from his body into her mouth. Empty room, nothing else in the room. Only two people.
```

### 2.3d Handjob POV (face-level, как BJ) — LOCK

Тот же кадр, что blowjob POV, но член в руке у лица, не во рту.

```
Photorealistic First-person POV looking down from above. olh_person petite woman kneeling nude, face close to his cock at mouth height, looking up into the camera. She holds his thick cock in her hand and strokes the shaft, cock not in her mouth, lips closed. His hips and cock enter from the top of frame, cock comes straight from his body into her hand. Empty room. Only two people.
```

### 2.3e Handjob POV (under shaft / balls)

Вариация ниже: она под членом и яйцами.

```
Photorealistic First-person POV looking down from above. olh_person petite woman kneeling low under his cock and balls, looking up from below the shaft, holding and stroking his thick cock from underneath, cock not in her mouth. His hips, balls and cock dominate the upper frame. Empty room. Only two people.
```

### 2.4 Missionary extreme CU (с тазом мужчины)

```
Photorealistic erotic extreme close-up at night, warm bedside lamp. Tight crop on the sex: olh_person petite nude woman on her back, thighs open filling the frame, knees bent. At the top edge a bald muscular man's lower belly and hips press in; his thick cock comes straight from his body into her wet pussy, tip at her entrance. Male pelvis and cock are one continuous body, not floating, not coming out of her. Wet skin, messy sheets soft-blurred, shallow depth of field. Only two people.
```

### 2.5 Cowgirl — LOCKED

```
Photorealistic erotic medium shot at night, warm bedside lamp light, soft bedroom atmosphere, messy sheets. olh_person petite young woman completely nude straddling a large bald muscular man, she is on top sitting upright on his hips, his thick cock buried deep inside her pussy, her small breasts and flat belly visible, thighs spread over him, hands on his chest, head slightly tilted looking at him with flushed pleasure face, his torso and muscular arms in frame below her, wet connection at her crotch partially visible, natural skin sweat sheen, shallow depth of field, candid realistic photo. Only two people.
```

### 2.6 Spooning — LOCKED

```
Photorealistic intimate side-view spooning sex photo at night, warm bedside lamp light, soft bedroom atmosphere, messy sheets. olh_person petite young woman completely nude lying on her side, knees slightly bent, a large bald muscular man spooning behind her also nude, his thick cock buried in her pussy from behind, one of his arms wrapped around her waist, her small breasts and profile face visible, wet penetration detail at her hips, bodies pressed close, soft natural skin texture, shallow depth of field, candid realistic photo. Only two people.
```

### 2.7 Wall stand — LOCKED

```
Photorealistic erotic photo at night, warm lamp. olh_person petite nude woman standing facing the wall, hands on the wall, bald muscular man standing behind her fucking her, cock inside, one hand on her hip. She turns her face slightly to the side. Bedroom, mid-thigh up framing. Only two people.
```

### 2.8 Missionary medium faces — LOCKED

```
Photorealistic medium shot at night, warm bedside lamp. olh_person petite nude woman lying on her back on the bed. Bald muscular man on top in missionary between her legs, his cock inside her. Both faces visible, she looks up at him. His two arms support him on the bed beside her. Her arms rest on the sheets. Messy sheets, natural skin, shallow DOF. Only two people.
```

### 2.9 Lap sit — LOCKED

```
Photorealistic intimate face-to-face lap sitting sex photo at night, warm bedside lamp light, soft bedroom atmosphere. Large bald muscular man sitting on the edge of the bed completely nude, olh_person petite young woman completely nude sitting on his lap facing him, legs around his waist, his thick cock buried inside her pussy, arms around each other's shoulders and necks, foreheads close, looking into each other's eyes, small breasts pressed to his chest, wet connection at their hips partially visible, natural skin sweat sheen, medium shot, candid realistic photo. Only two people.
```

### 2.10 Prone bone — LOCKED

```
Photorealistic erotic photo at night, warm lamp. olh_person petite nude woman lying on her stomach on the bed, bald muscular man lying on top of her back, cock inside her from behind, prone bone. Her face on the pillow in profile, his chest on her back. Messy sheets. Only two people.
```

### 2.11 Face kiss CU — LOCKED

```
Photorealistic extreme close-up at night, warm lamp. olh_person and a bald muscular man kissing, faces fill the frame, eyes half closed, bare shoulders at the bottom, messy sheets blurred behind. Soft skin, shallow DOF. Only two people.
```

### 2.12 Не использовать / удалённые

- **Edge of bed (он стоит, ноги вверх)** — нестабильно, убран из пака.
- Сверхдлинные v3 anatomy-lock промпты — ухудшают результат.

---

## 3. Flux — МОЖНО / НЕЛЬЗЯ (примеры)

### 3.1 Стиль промпта

| | Пример |
|--|--------|
| **МОЖНО** | `Photorealistic side-view spooning at night, warm lamp. olh_person nude on her side, bald man behind her, cock inside, arm around her waist. Only two people.` |
| **НЕЛЬЗЯ** | `spooning, 1girl, 1boy, cock, pussy, masterpiece, best quality, (extra limbs:1.3), negative: bad anatomy...` |

### 3.2 Запреты

| | Пример |
|--|--------|
| **МОЖНО** | `Only two people. Empty dark office, nothing else in the room.` |
| **НЕЛЬЗЯ** | `no third person, no second woman, no extra man, no clone, no fused limbs, no extra fingers, no five arms, must not include...` (длинный список) |

### 3.3 Doggy POV

| | Пример |
|--|--------|
| **МОЖНО** | `POV looking down from a standing man. She bent forward standing doggy on the floor. Cock inside from behind.` |
| **НЕЛЬЗЯ** | `NOT reverse cowgirl, he is NOT lying on his back, she is NOT on top...` |

### 3.4 Extreme CU sex

| | Пример |
|--|--------|
| **МОЖНО** | `Man's lower belly and hips at top of frame; cock comes from his body into her pussy.` |
| **НЕЛЬЗЯ** | `extreme macro only pussy and cock, no male body` → часто «член-объект» |

### 3.5 Склейка стиля

| | Пример |
|--|--------|
| **МОЖНО** | Один стиль: `harsh direct flash...` + поза + `night office` |
| **НЕЛЬЗЯ** | `disposable film + neon + studio softbox + cinematic teal orange` в одном промпте |

### 3.6 Длина

| | |
|--|--|
| **МОЖНО** | 50–90 слов, одна сцена |
| **НЕЛЬЗЯ** | 200+ слов с 15 правилами анатомии |

---

## 4. Minimax H3 — видео (I2VA)

### 4.1 Пайплайн

1. Сгенерировать **still** во Flux (финальный кадр = Picture 1).  
2. Оживить в **Minimax H3 I2VA**, прикрепив этот still.  
3. Длительность: **6–10 с**.  
4. Речь/диалоги: по умолчанию **нет** (стоны/звуки — в soundscape).

### 4.2 Структура видео-промпта

```
For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.

integrated_multimodal_description: [Shot 1] Live-action, [STYLE LOCKED TO PICTURE 1]. [LOCATION]. Scene opens fully locked to <Picture 1>: [who/pose exactly as still]. Then [ACTION + TEMPO + FORCE]. Camera [static / tiny shake]. Only these two people. [Style consistency line].

overall_soundscape: [room tone]. [sex sounds: thrusts, hip slaps]. [male grunts]. [female moans/cries]. No music, no dialogue words, no extra people.

non_diegetic_music: N/A
```

### 4.3 Правила видео

1. **Старт = Picture 1** — явно: `opens fully locked to <Picture 1>`.  
2. Стиль **наследовать** из still: flash / neon / disposable grain / etc.  
3. Движение: простые глаголы + темп:  
   - `aggressively fucks`  
   - `high hard tempo` / `fast deep violent thrusts`  
   - `strong hip slams` / `full-force pounding` / `relentless`  
4. Камера: `mostly static` + `tiny handheld shake matching thrusts` (для hard sex).  
5. Звук — **отдельно** в `overall_soundscape`, не только в description:  
   - `sharp loud skin slap of hips against her ass on every deep penetration`  
   - `female loud moans turning into sharp cries and screams`  
   - `male low effort grunts`  
6. Не добавлять новых персонажей, новую локацию, смену позы на другую.  
7. `non_diegetic_music: N/A` если музыка не нужна.

### 4.4 Шаблон агрессивного темпа (фрагмент)

```
Then he aggressively fucks her at a high hard tempo: fast deep violent thrusts, strong hip slams, full-force pounding, body jolts with each impact, relentless rough pace, no slow gentle motion.
```

### 4.5 Шаблон звука (фрагмент)

```
overall_soundscape: [quiet room tone]. Loud wet aggressive sex: hard continuous high-tempo thrusting, sharp loud skin slap of hips on every deep penetration, heavy rhythmic impacts. Male low effort grunts. Female loud moans turning into sharp cries and screams with each hard slam, breathless gasps. No music, no dialogue words, no extra people.
```

### 4.6 Короткая форма видео (если лимит)

```
I2V from reference: [style keywords from still]. [pose one line]. He aggressively fucks her hard and fast, high tempo, violent deep thrusts, strong hip slams. Loud hip slap every thrust, wet sex, her loud moans cries screams, his grunts. Micro-shake. Only two people. No music.
```

### 4.7 LoRA Epic Cumshots (только мужской оргазм)

Файл: `loras/minimax/epic_cumshots-MiniMaxH3-ALPHA-CUMSH0T.safetensors`  
Триггер: **`CUMSH0T`** (ноль, не буква O). Сила: 1.0. Вешается на UNET MiniMax, **не** на каждый секс-ролик.

**Включать**, если в комментарии/промпте явно есть камшот / эякуляция / «он кончает» / semen / creampie.  
**Не включать** на обычный секс и на «она кончает» без эякуляции мужчины.

В `[Shot 1]` сразу после лока к Picture 1:

```
CUMSH0T. The penis ejaculates small pulses of white translucent thick viscous semen that lands on [face / tongue / chest / inside — по сцене].
```

Не выдумывать камшот, если пользователь его не просил.

---

## 5. Полные примеры «как надо» (фото + видео)

### 5.1 Disposable film + doggy POV + панорамное окно на город

**Фото:**
```
Cheap disposable film camera photo, heavy film grain, soft unsharp plastic 32mm lens, faded colors, warm dirty yellow cast, imperfect exposure, optically soft, snapshot composition, nostalgic print scan, no light leak, no glowing edges. Dark bedroom at night with a large panoramic window showing a blurred night city skyline with distant lights. Photorealistic POV looking down from a standing man: olh_person petite woman bent forward standing doggy on the floor, ass toward camera, his thick cock inside her pussy from behind, she turns her head and looks back over her shoulder into the camera. Warm practical lamp mixed with cool city glow from the window, empty dark room otherwise. Only two people.
```

**Видео:** см. структуру §4.2 + aggressive tempo + soundscape; style lock: disposable grain, faded yellow, panoramic city window.

### 5.2 Direct flash + missionary CU + ночной офис

**Фото:**
```
Photorealistic on-camera direct flash extreme close-up at night inside an empty office cabinet room. Harsh frontal flash, hard shadows, high contrast, clinical cold-white light, glossy skin specular hits, raw unflattering flash aesthetic, 35mm snapshot look, f/8, deep focus, sharp and crude. Tight crop on the sex: olh_person petite nude woman on her back on a desk or office surface, thighs open filling the frame, knees bent. At the top edge a bald muscular man's lower belly and hips press in; his thick cock comes straight from his body into her wet pussy, tip at her entrance. Male pelvis and cock are one continuous body, not floating, not coming out of her. Wet skin, blurred office desk papers and dark night office background, hard flash shadow behind. Only two people.
```

### 5.3 Neon + spooning + ночной офис

**Фото:**
```
Photorealistic intimate side-view spooning sex photo at night inside an empty office cabinet room. Lit by magenta and cyan neon from the window and desk accents, mixed colored gels on bare skin, strong color contrast, dark environment, reflective wet-looking highlights on bodies, 35mm lens, f/1.8, shallow DOF, neon bokeh in the dark office background, high contrast stylized nightlife color. olh_person petite young woman completely nude lying on her side on a desk or office couch, knees slightly bent, a large bald muscular man spooning behind her also nude, his thick cock buried in her pussy from behind, one arm wrapped around her waist, her small breasts and profile face visible, wet penetration detail at her hips, bodies pressed close, soft natural skin under neon. Only two people.
```

---

## 6. Чеклист перед отправкой промпта

### Flux still
- [ ] Один абзац prose, EN
- [ ] Есть стиль/свет **или** явно photorealistic + lamp
- [ ] `olh_person` + стабильный man-template
- [ ] Поза одной геометрией (без anti-списка)
- [ ] Если есть penetration close-up — виден **мужской таз/живот**
- [ ] Локация одной фразой
- [ ] Конец: `Only two people.`
- [ ] Нет SD-весов и нет long negative wall
- [ ] Не смешаны 3 эстетики камеры

### Minimax video
- [ ] Есть ` <Picture 1> ` / locked to reference
- [ ] Стиль = как на still
- [ ] Сначала freeze позы still, потом действие
- [ ] Темп/сила явными словами
- [ ] Soundscape: slap + moans/cries + grunts
- [ ] `Only these two people` / no extra people
- [ ] Music N/A если не нужна

---

## 7. Алгоритм для ИИ-автора промптов

Когда пользователь просит новый промпт:

1. **Уточнить (или взять из контекста):** поза, стиль камеры, локация, look back/away, нужен ли still / video / оба.  
2. **Взять LOCKED-позу** из §2 если совпадает; не изобретать edge-of-bed и прочие отбракованные.  
3. **Склеить:** Style → Location → Pose → Anchor → Only two people.  
4. **Длина:** уложиться в ~40–100 слов для Flux.  
5. Если video: обернуть в I2VA-структуру §4.2; действие не меняет позу кардинально.  
6. Если пользователь жалуется на лишних людей — **укоротить** промпт и убрать все “no/not”, оставить `Only two people` + `empty ...`.  
7. Если член «отрывается» — добавить hips/belly continuous body, чуть расширить кроп.  
8. Если стало хуже после «улучшения» — **откатить** к последней locked-версии, не наслаивать новые запреты.  
9. Не «улучшать» пресеты со статусом locked без запроса.  
10. Ответ пользователю: дать готовый copy-paste блок(и), кратко пометить Photo / Video.

---

## 8. Словарь темпа и звука (EN, для video)

**Темп / сила:**  
`aggressively fucks`, `high hard tempo`, `fast deep violent thrusts`, `strong hip slams`, `full-force pounding`, `relentless rough pace`, `body jolts with each impact`, `ass and thighs shake`, `no slow gentle motion`

**Звук:**  
`sharp loud skin slap of hips against her ass`, `wet thrusting`, `heavy rhythmic impacts`, `male low effort grunts`, `female loud moans`, `sharp cries and screams`, `breathless gasps`, `desk creak` / `bed creak`

**Камера video:**  
`mostly static POV`, `tiny handheld shake matching the hard thrusts`, `opens fully locked to <Picture 1>`

---

## 9. Статус поз (лабораторный итог)

| ID | Поза | Статус |
|----|------|--------|
| 1 | Missionary extreme CU (с male hips) | рабочий паттерн; pure macro без таза — нет |
| 2A | Doggy **side** look back | side / 3/4, не POV |
| 2B | Doggy **side** face away | side / 3/4, не POV |
| 2A-pov | Doggy **POV** look back | `looking down from above from a standing man` |
| 2B-pov | Doggy **POV** face away | то же + face away |
| 2C-bj | Blowjob POV mouth | kneeling, cock in mouth |
| 2D-hj | Handjob POV face-level | как BJ, но в руке у лица |
| 2E-hj | Handjob POV under shaft | под членом / яйцами |
| 3 | Cowgirl | **LOCKED** |
| 4 | Spooning | **LOCKED** |
| 5 | Wall stand | **LOCKED** |
| 6 | Missionary medium faces | **LOCKED** |
| 7 | Edge of bed | **REMOVED** |
| 8 | Lap sit | **LOCKED** |
| 9 | Prone bone | **LOCKED** |
| 10 | Face kiss CU | **LOCKED** |

---

## 10. Краткие «золотые правила» (памятка)

1. Klein = **короткий positive prose**, не SD-negative.  
2. `Only two people` > страница запретов.  
3. Член всегда **от мужского тела** в кадре.  
4. Гравитацию позы писать явно (standing / on her back / on top).  
5. Один стиль камеры на промпт.  
6. Видео = still + движение + soundscape; не переписывать сцену заново.  
7. Сломалось после усложнения → упростить и откатить.  
8. Locked пресеты не «улучшать» без нужды.

---

*Версия документа: 1.0 (по результатам итераций Flux Klein SNOFS + Minimax H3 I2VA).*  
*Character trigger по умолчанию: `olh_person`. Мужчина по умолчанию: `bald muscular adult man`.*
