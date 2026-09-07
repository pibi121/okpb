# Лицензии моделей (peachbitch) — сводка для коммерции

Дата сбора: **2026-08-02**  
Статус: исследование для планирования, **не юрзаключение**. Перед платным запуском — перепроверить страницы моделей и при необходимости юриста.

Продукт: **платный** сервис (кредиты → генерация NSFW для взрослых).  
PoC / личные тесты на GPUGO ≠ коммерческий прод.

---

## Вердикт в одну строку

| Компонент | Коммерческий self-host в peachbitch |
|-----------|-------------------------------------|
| **UltraReal v4** (текущая база) | ❌ Нет (FLUX.1 [dev] Non-Commercial) |
| **Persephone Flux** | ❌ Нет (то же) |
| **FLUX.1 [dev]** и любые его файнтюны/мерджи | ❌ Без платной лицензии BFL |
| **Твоя Flux-LoRA** | ⚠️ Права на LoRA у тебя, но **не отменяет** лицензию базы |
| **Pony Diffusion V6 XL** | ❌ Монетизированный inference запрещён без разрешения авторов |
| **Wan 2.1 I2V** | ✅ Apache 2.0 — коммерция обычно ОК |
| **Z-Image / Z-Image-Turbo** | ✅ Apache 2.0 — сильный кандидат вместо UltraReal |
| **FLUX.1 [schnell]** | ✅ Apache 2.0 — коммерция ОК; качество/стиль ≠ UltraReal |
| **FLUX.2 [klein] 4B** | ✅ Apache 2.0 — коммерция ОК; другой класс качества |
| **BFL API (официальный)** | ✅ Коммерция в цене API; **NSFW обычно режется фильтрами** — плохо стыкуется с peachbitch |

---

## 1. То, чем уже пользуетесь

### UltraReal Fine-Tune v4
- Источник: [Civitai — UltraReal Fine-Tune](https://civitai.com/models/978314/ultrareal-fine-tune)
- База: **Flux.1 D** (= линия FLUX.1 [dev])
- Лицензия на карточке: **FLUX.1 [dev] Non-Commercial License**
- Вывод: бесплатно для PoC / некоммерции; **нельзя** крутить как движок платного продукта без коммерческой лицензии у Black Forest Labs (+ учитывать автора файнтюна).

### Persephone [Flux NSFW/SFW]
- Источник: [Civitai — Persephone](https://civitai.com/models/1775002/persephone-flux-nsfwsfw)
- База: Flux.1 D
- Лицензия: **FLUX.1 [dev] Non-Commercial**
- Вывод: то же, что UltraReal.

### Character LoRA (`olh_person_flux_lora`)
- Обучена на ваших фото → права на веса LoRA у вас.
- Генерация всё равно через UltraReal/Flux [dev] → **ограничения базы остаются**.
- Отдельно: согласие модели на коммерческое использование её внешности (договор / оферта) — продуктовый риск, не «лицензия Civitai».

### Pony Diffusion V6 XL (ранний PoC)
- Лицензия: modified **Fair AI Public License 1.0-SD**
- Явный запрет: inference на сайтах/приложениях с **монетизацией** (paid inference, платные тиры и т.п.), включая деривативы/мерджи.
- Коммерция: писать `contact@purplesmart.ai`; Civitai/HF имеют отдельное разрешение.
- Вывод: **нельзя** просто воткнуть Pony в платный peachbitch.

---

## 2. Black Forest Labs (FLUX) — как устроена коммерция

Официально:
- [Open Weights Licensing](https://bfl.ai/licensing)
- [How does FLUX licensing work?](https://help.bfl.ai/articles/9272590838-self-serve-dev-license-overview-pricing) (обновлено June 12, 2026)
- [Non-Commercial terms](https://bfl.ai/legal/non-commercial-license-terms)

### Без оплаты (open weights)
| Модель | Лицензия | Коммерческий self-host |
|--------|----------|-------------------------|
| FLUX.1 [dev] | Non-Commercial | ❌ Нужна платная лицензия |
| FLUX.2 [dev] / klein 9B / Kontext [dev] | Non-Commercial | ❌ |
| FLUX.1 [schnell] | Apache 2.0 | ✅ |
| FLUX.2 [klein] 4B | Apache 2.0 | ✅ |

Non-Commercial прямо запрещает commercial / production / revenue-generating и использование с impact на end users.  
Также запрещены CSAM, non-consensual intimate images и пр. незаконный контент.

### Платная лицензия на веса (self-host)
Тиры (цены **не публикуют** для Platform+ — sales):

| Тир | Для кого | Объём (ориентир) | Модели в описании |
|-----|----------|------------------|-------------------|
| **Builder** | ранняя команда, не клиентский SaaS | 10K img/мес, 1 domain | FLUX.2 [klein]; **не для downstream/client apps** |
| **Platform** | SaaS / фича для end users | 100K img/мес, 1 domain | FLUX.2 klein 9B + FLUX.2 [dev] |
| **Professional** | агентства под клиентов | 100K, до 3 domains/clients | FLUX.2 [dev] |
| **Enterprise** | кастом | custom | всё |

Важно для peachbitch:
1. Тиры сейчас заточены под **FLUX.2**; для **FLUX.1 [dev]** / файнтюнов Civitai — уточнять у sales (`sales@blackforestlabs.ai`), входит ли ваш кейс и add-on.
2. **Builder явно «Not meant for client use or downstream applications»** — для платного кабинета пользователям нужен минимум **Platform** (или Enterprise).
3. Цена Platform/Professional **только через sales** — в калькуляторе на сайте публичных $ за weights license нет.
4. Официальный **BFL API**: коммерческие права на выходы включены в per-image; для NSFW-продукта обычно **не подходит** (фильтры / Acceptable Use).

### Ориентир стоимости API (не self-host)
С публичного прайсинга BFL / обзоров (порядок величин, 2026): от ~**$0.01–0.07** за картинку в зависимости от модели FLUX.2. Это **не** замена self-host NSFW на GPUGO.

---

## 3. Видео: Wan 2.1

- Репозиторий: [Wan-Video/Wan2.1](https://github.com/Wan-Video/Wan2.1) — **Apache License 2.0**
- Коммерческое использование весов в целом **разрешено**.
- Авторы оставляют ответственность за контент за вами; нельзя вредоносный / незаконный контент (формулировки в README).
- Вывод: этап B (I2V) по лицензии **проще**, чем кадры на UltraReal.  
  Но: вход в I2V — картинка с Flux-[dev]-файнтюна; для **платного** пайплайна «still + video» всё равно нужно легально закрыть **кадры**.

---

## 3b. Кандидат still: Z-Image (Tongyi / Alibaba)

Исследование: **2026-08-02**. Официально: [Tongyi-MAI/Z-Image](https://github.com/Tongyi-MAI/Z-Image), HF: [Z-Image](https://huggingface.co/Tongyi-MAI/Z-Image) / [Z-Image-Turbo](https://huggingface.co/Tongyi-MAI/Z-Image-Turbo).

| | |
|--|--|
| Параметры | **6B** (легче Flux 12B) |
| Лицензия | **Apache 2.0** → коммерческий self-host ✅ |
| VRAM | Turbo комфортно в ~16 GB; на 5090 — с запасом |
| Скорость | Turbo: **~8 steps**, очень быстро |
| ComfyUI | Есть официальные workflow ([docs.comfy.org](https://docs.comfy.org/tutorials/image/z-image/z-image)) |
| LoRA | Да (Ostris AI-Toolkit + training adapter для Turbo); Base проще для fine-tune |
| NSFW | База не «porn-first»; на Civitai растёт экосистема; для peachbitch — тест + возможно NSFW-файнтюн/LoRA |
| Совместимость с текущей Flux-LoRA | **Нет** — нужна новая character LoRA |

**Качество vs UltraReal / Flux [dev] (сводно по обзорам 2025–2026):**
- Не «сильно хуже» как класс: Turbo часто в топе open-source (Artificial Analysis: #1 OSS на момент релиза).
- Портреты / кожа / свет — у многих ревьюеров **на уровне или лучше** Flux.2 в портретах; vs ваш UltraReal — **надо A/B на GPU**, слепо не решать.
- Сложные мульти-субъектные промпты / жёсткий контроль композиции — чаще чуть сильнее большой Flux.
- Цена качества: меньше экосистемы, чем у Flux; Turbo сложнее учить без adapter.

**Рекомендация для peachbitch:** сильный **план B по лицензии** (вместе с Wan из одной «семьи» Alibaba). Для продакшена предпочтительнее **Z-Image (Base)** или De-Turbo для train + Turbo для быстрой генерации — проверить глазами на NSFW/анатомии.

---

## 4. Что это значит для плана peachbitch

### Можно сейчас (PoC)
- GPUGO + UltraReal + LoRA + эксперименты Wan — как **некоммерческая разработка / тест**.
- Не продавать генерации end-user’ам на этих весах.

### Перед платным запуском — выбрать одну стратегию

**A. Купить коммерческую лицензию BFL (Platform/Enterprise)**  
- Плюс: остаётесь на качестве уровня Flux [dev] / FLUX.2.  
- Минус: цена неизвестна (sales); может не покрывать чужие NSFW-мерджи; NSFW-политика лицензии/ToS — **обязательно спросить у BFL письменно**.  
- UltraReal/Persephone: даже с лицензией на базу — проверить, не добавляет ли автор Civitai своих запретов.

**B. Сменить still-базу на коммерчески свободную**  
- Кандидаты: **FLUX.1 [schnell]**, **FLUX.2 [klein] 4B**, другие Apache/MIT/SDXL-пермиссивные NSFW-чекпоинты.  
- Плюс: без чека BFL за веса.  
- Минус: качество ≠ UltraReal; нужна новая LoRA и заново калибровка.

**C. Гибрид**  
- Кадры: своя/пермиссивная коммерческая база + ваша LoRA.  
- Видео: Wan (Apache).  
- Не строить прод на UltraReal/Persephone «как есть».

**D. Pony в прод**  
- Только после **письменного** разрешения SoftOwl / `contact@purplesmart.ai`.  
- Сейчас качество вы уже отложили в пользу Flux — низкий приоритет.

---

## 5. Деньги — что посчитать заранее

| Статья | Известно? | Действие |
|--------|-----------|----------|
| GPUGO 5090 ~57 ₽/час | да | unit-cost кадра/видео |
| BFL weights Platform | **нет публичной цены** | запросить quote: SaaS NSFW? FLUX.1 vs 2? volume |
| BFL API | ~$0.01–0.07/img | скорее не для NSFW |
| Wan | $0 за лицензию | только GPU |
| Pony commercial | переговоры | email авторам |
| Согласие лица на LoRA | продукт | договор с моделью |

Грубая логика unit economics:
`цена кредита пользователю` ≥ `GPU-время + (лицензия BFL / N картинок) + маржа`.

Пока нет quote от BFL — закладывать **сценарий B (смена базы)** как запасной план по стоимости.

---

## 6. Чеклист действий (лицензии)

1. [ ] Зафиксировать прод-стек: still-модель + I2V (не «что скачали на PoC»).
2. [ ] Если хотите остаться на Flux-[dev]-качестве → письмо в BFL sales: self-host SaaS, adult content, volume, FLUX.1 fine-tune.
3. [ ] Параллельно: shortlist 1–2 **Apache/commercial-OK** still-моделей под NSFW и тест качества.
4. [ ] Wan 2.1 — ок для этапа B по лицензии; не считать кадры «закрытыми» из‑за Wan.
5. [ ] Не использовать Pony в платном продукте без разрешения.
6. [ ] Юрист перед приёмом платежей (РФ/оферта/18+/персональные данные лиц на LoRA).

---

## Ссылки

- UltraReal: https://civitai.com/models/978314/ultrareal-fine-tune  
- Persephone: https://civitai.com/models/1775002/persephone-flux-nsfwsfw  
- BFL licensing: https://bfl.ai/licensing  
- BFL help (tiers): https://help.bfl.ai/articles/9272590838-self-serve-dev-license-overview-pricing  
- FLUX.1 schnell: https://huggingface.co/black-forest-labs/FLUX.1-schnell  
- Wan2.1: https://github.com/Wan-Video/Wan2.1  
- Pony V6 XL (лицензия на HF-карточках зеркал): запрет monetized inference → contact@purplesmart.ai  
