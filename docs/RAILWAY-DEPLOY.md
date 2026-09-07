# Railway deploy — PeachBitch

## Ошибка «Failed to fetch repository files»

Чаще всего репозиторий на GitHub **пустой** (нет коммитов). Railway не может задеплоить пустой repo.

**Исправление:**

1. Залить код в GitHub (хотя бы 1 коммит в ветке `main`)
2. GitHub → **Settings → Applications → Railway** → Configure → дать доступ к репо `pibi121/okpb`
3. Railway → Service → Settings → connect GitHub repo `pibi121/okpb`

Если не помогло — деплой через CLI (см. ниже).

---

## Архитектура на Railway

Один сервис (web + bot):

- **Next.js** — сайт, Mini App, API
- **Telegram bot** — long-poll (`npm run tg:bot`)
- **Volume** — mount `/app/data` (фото моделей, галерея, SQLite)
- **Postgres** (опционально позже) — пока SQLite на Volume

---

## Переменные окружения (Railway → Variables)

| Variable | Пример |
|----------|--------|
| `DATABASE_URL` | `file:./data/prod.db` |
| `TELEGRAM_BOT_TOKEN` | из BotFather |
| `TELEGRAM_MINIAPP_URL` | `https://YOUR-APP.up.railway.app/tg/templates` |
| `TELEGRAM_BOT_PUBLIC_URL` | `https://t.me/peachbibot` |
| `AUTH_SECRET` | случайная строка 32+ символов |
| `COMFY_FORCE_MOCK` | `1` (пока без GPU) |
| `NODE_ENV` | `production` |

После деплоя обновить `TELEGRAM_MINIAPP_URL` на финальный URL и в BotFather → Menu Button.

---

## Volume

Railway → Service → **Volumes** → Add Volume:

- Mount path: `/app/data`

---

## BotFather

Menu Button → Web App URL: `https://YOUR-DOMAIN/tg/templates`

---

## CLI deploy (если GitHub link не работает)

```bash
npm i -g @railway/cli
railway login
railway link
railway up
```
