# PeachBitch TG — роадмап разработки

**Версия:** v1.0 · 1 сентября 2026  
**Запуск:** 7 сентября 2026  
**Принцип:** сегодня — всё без GPU/серверов; GPU подключаем когда каркас готов.

---

## Фаза 0 — СЕГОДНЯ (1 сентября, без GPU)

### Документация ✅
- [x] PEACHBITCH-TG-PLAN.md
- [x] PEACHBITCH-TG-ECONOMICS.md
- [x] PEACHBITCH-TG-OPEN-QUESTIONS.md
- [x] PEACHBITCH-TG-USER-JOURNEY.md
- [x] PEACHBITCH-TG-ROADMAP.md (этот файл)

### Схема данных
- [x] `PlatformAccount` (telegram user id → User)
- [x] `BotInstance` (активный бот, redirect URL)
- [x] `AffiliateAccount` + `AffiliateAttribution`
- [x] `PhotoTemplate` (фото-шаблоны Krea)
- [x] `User.balanceRub` + `User.source`
- [x] Synthetic email для TG-only users (`tg_*@peachbitch.local`)

### Код (локально, mock GPU)
- [x] `src/lib/tg/` — auth initData, user linking
- [x] `src/lib/tg-pricing.ts` — RUB SKU
- [x] `src/lib/krea-graphs.ts` — `buildKreaDualRefEditGraph`
- [x] `src/lib/photo-template.ts` — list templates
- [x] `src/lib/tg/bot-config.ts` — active bot URL
- [x] `src/app/api/tg/auth/route.ts`
- [x] `src/app/api/tg/bot-config/route.ts`
- [x] `src/app/api/tg/templates/route.ts`
- [x] `src/app/api/tg/webhook/route.ts` (заглушка)
- [x] `src/app/bot/route.ts` — redirect на актуального бота
- [x] `src/app/tg/templates/page.tsx` — Mini App shell
- [x] `scripts/tg-bot-dev.mjs` — long-poll dev bot
- [x] `.env.example` — TELEGRAM_BOT_TOKEN, etc.

### Контент / ops (ручное)
- [ ] Зарегистрировать бота в BotFather
- [ ] Создать канал-переходник
- [ ] Ответить на OPEN-QUESTIONS (блокеры)

---

## Фаза 1 — До 7 сентября (MVP)

### Неделя 1 (2–6 сен)

| День | Задача |
|------|--------|
| 2 сен | Prisma migrate + TG auth flow |
| 3 сен | Bot: /start, 18+, меню, загрузка фото персонажа |
| 4 сен | Mini App: лента шаблонов (видео из QuickVideoTemplate) |
| 5 сен | Generate flow: выбор шаблона → списание ₽ → job queue |
| 6 сен | Оплата (Stars или crypto stub) + push «готово» |
| 7 сен | **Запуск** + канал + redirect |

### MVP scope (строго)
- ✅ Видео-шаблоны (Quick Video)
- ✅ Персонаж (refs only)
- ✅ Баланс в ₽
- ✅ Реф-ссылки арбитража
- ⚠️ Фото-шаблоны — если успеем dual-ref smoke
- ❌ LoRA train
- ❌ TTS custom voice
- ❌ Elastic GPU (ручной Metalnode)

---

## Фаза 1.5 — Октябрь

- [ ] Mini App: autoplay, фильтры, свайп
- [ ] Фото-шаблоны (Krea dual-ref) в проде
- [ ] Поле «текст реплики» в видео
- [ ] Партнёрский кабинет (статистика, выплаты)
- [ ] EN UI
- [ ] Redis queue вместо in-memory
- [ ] PostgreSQL на VPS
- [ ] RunPod burst (скрипт spawn-worker)

---

## Фаза 2 — Ноябрь+

- [ ] LoRA train async + push
- [ ] Auto GPU scaling
- [ ] Custom voice (TTS)
- [ ] Peach Studio upsell landing
- [ ] A/B цен

---

## Зависимости (что от чего)

```
OPEN-QUESTIONS ответы
        ↓
Prisma schema
        ↓
TG auth API ←→ Bot skeleton
        ↓
Character upload (reuse /api/characters)
        ↓
Template list API ←→ Mini App UI
        ↓
Generate run (reuse quick-video) ←── GPU (Metalnode)
        ↓
Webhook notify → sendVideo
```

**Сегодня делаем всё до «Generate run»** с `COMFY_FORCE_MOCK=1`.

---

## Чеклист «готов к подключению GPU»

- [ ] Bot принимает фото, создаёт Character
- [ ] Mini App показывает шаблоны
- [ ] «Использовать» создаёт QuickVideoRun в БД
- [ ] Job enqueue вызывается (mock возвращает placeholder)
- [ ] Бот шлёт placeholder video в чат
- [ ] Redirect /bot работает
- [ ] Affiliate ref пишется в ledger

Когда всё ✅ — поднимаем tunnel к Metalnode, убираем mock, один e2e тест.

---

## Структура файлов (целевая)

```
peachbitch/
├── docs/PEACHBITCH-TG-*.md
├── packages/tg-bot/
│   ├── index.ts          # grammY entry
│   ├── handlers/
│   └── notify.ts         # job done → sendVideo
├── src/
│   ├── lib/tg/
│   ├── lib/tg-pricing.ts
│   ├── lib/photo-template.ts
│   ├── app/api/tg/
│   ├── app/bot/route.ts
│   └── app/tg/templates/  # Mini App
└── prisma/schema.prisma   # + PlatformAccount, etc.
```
