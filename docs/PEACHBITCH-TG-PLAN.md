# PeachBitch Telegram — план продукта

**Версия:** v1.0 · 1 сентября 2026  
**Статус:** утверждено  
**Старт:** 7 сентября 2026  
**Связано:** `PEACHBITCH-TG-ECONOMICS.md`, `PEACHBITCH-TG-USER-JOURNEY.md`, `PEACHBITCH-TG-ROADMAP.md`, `PEACHBITCH-TG-OPEN-QUESTIONS.md`

---

## 1. Что это

**PeachBitch** — Telegram-бот (MVP) в нише NSFW-генерации. Воронка в основной сервис **Peach Studio** (веб-лаб).

### Отличия от конкурентов

| Конкуренты | PeachBitch |
|------------|------------|
| Каждый раз загружать фото | **Персонаж один раз** → много генераций |
| Кнопки в чате | **Mini App** — лента шаблонов (Reels-UX) |
| Слабое видео / только фото | **MiniMax Ref2V** + **Krea Identity Edit** для фото |
| Нет воронки в студию | Coming soon → Peach Studio |

---

## 2. Точки входа (всегда живые)

```
@PeachBitchChannel  (канал-переходник)
    └── закреп: актуальная ссылка на бота

peachbitch.com/bot  (редирект из БД)
    └── 302 → t.me/актуальный_бот

@PeachBitchBot  (может умереть → меняем только ссылки выше)
    ├── чат: персонаж, баланс, генерация
    └── Mini App: лента шаблонов
```

**Принцип:** данные в backend, не в Telegram. `telegram_user_id` постоянен; username бота сменный.

---

## 3. Продуктовые потоки

### Персонаж (бесплатно)

- 3–5 фото в чат → identity pack
- Без LoRA на старте
- Используется во всех шаблонах

### Фото-шаблоны (54–87 ₽)

- **Krea Identity Edit v1.2** (`conradlocke/krea2-identity-edit`)
- Референс: фото юзера + превью шаблона (dual-ref)
- ~15–25 сек

### Видео-шаблоны (142–384 ₽) — основной SKU

- **Quick Video / MiniMax Ref2V**
- Референс: identity pack персонажа
- Шаблон: marketplace (уже в коде)

### Premium (позже)

- LoRA train — 990 ₽
- Custom voice (TTS) — v1.5
- Речь в шаблоне — текст в промпте MiniMax (v1)

---

## 4. Архитектура

```
Telegram User
    ↓ webhook
Bot Worker (grammY, always-on VPS)
    ↓
Next.js /api/tg/*  +  /api/peach/*
    ↓
PostgreSQL (позже; сейчас SQLite dev)
Redis queue (позже; сейчас in-memory)
    ↓
GPU Orchestrator → ComfyUI @ Metalnode / RunPod burst
```

### Миграция при бане бота (< 30 мин)

1. Новый бот в BotFather
2. `BotInstance` в БД → active
3. `peachbitch.com/bot` редирект обновляется мгновенно
4. Закреп в канале
5. Webhook на новый токен
6. Юзер `/start` → тот же баланс, персонажи, история

---

## 5. Фазы

| Фаза | Срок | Содержание |
|------|------|------------|
| **0 — сегодня** | 1 сен | Доки, схема БД, каркас бота, Mini App shell, без GPU |
| **1 — MVP** | 7 сен | Бот: персонаж → шаблон → генерация → доставка |
| **1.5** | окт | Mini App лента, речь-текст, EN/RU, партнёрка |
| **2** | ноя+ | LoRA async, elastic GPU, TTS |

---

## 6. Инвестиции (утверждено)

| | |
|--|--|
| Сумма | 150 000 ₽ (запас до 250 000 ₽) |
| Доля инвесторов | **30% чистой прибыли** |
| Доля основателя | **70%** |
| На что | GPU 2–3 мес, трафик, резерв |

---

## 7. Риски

| Риск | Митигация |
|------|-----------|
| Бан бота | Канал + сайт + BotInstance |
| Очередь GPU | Elastic RunPod + pre-warm |
| Низкий CR | A/B цен, тизер free |
| 50% арбитраж | Свой канал (маржа 94% vs 44%) |

---

## 8. Что уже есть в peachbitch (переиспользуем)

- Quick Video + Ref2V (`quick-video.ts`)
- Шаблоны (`quick-video-template.ts`)
- Персонажи + ref pack (`character-ref-pack.ts`)
- Krea Edit single-ref (`krea-graphs.ts`)
- Billing / credits (`peach-economics.ts`, `billing.ts`)
- GPU queue (`gallery-jobs.ts`) — заменить на Redis позже

## Что строим с нуля

- Telegram bot + webhook
- `PlatformAccount`, `BotInstance`
- TG auth (initData)
- Mini App UI лента
- Photo templates + dual-ref Krea graph
- Affiliate tracking (50% lifetime)
- RUB pricing layer для бота
