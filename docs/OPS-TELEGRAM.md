# Ops Telegram — чат с ветками (форум)

Staff-бот шлёт живые события в супергруппу с темами. Это **не** продуктовый `@peachbibot`: отдельный токен, только внутренний чат.

Ветки:

| Тема | Что приходит |
|------|----------------|
| Оплаты | Кто оплатил в боте / Mini App, сумма 🍑 и ₽, способ, партнёр |
| Регистрации | Новый человек, канал, источник трафика, партнёр (есть/нет + код) |
| Маркетинг | 3 раза в сутки (МСК **07:00, 15:00, 00:00**) выжимка воронки `/ops/analytics` за прошедшее окно: кто куда жал |
| Ошибки | Всё, что падает в `reportOpsError` / `/ops/errors` (повтор одного fingerprint схлопывается раз в минуту) |
| Контроль качества | Заявки «не понравилось» из бота; статус правится при решении staff |
| Деплои | Коммит в `main` и успешный деплой на прод: sha, версия билда, время МСК, краткое описание |

## Что сделать Owner

1. BotFather → новый бот (например `@peachbitch_ops`) → токен. Не светить токен в чатах и git.
2. Telegram: новая **супергруппа** → включить **Темы (Topics)**.
3. Добавить бота **админом**: право писать + **управлять темами**.
4. Узнать id чата (вид `-100…`):
   - либо после пункта 3 локально: `cd peachbitch && npx tsx scripts/ops-telegram-bootstrap.ts` (скрипт 45 сек ждёт добавления и печатает id);
   - либо переслать любое сообщение из группы боту [@userinfobot](https://t.me/userinfobot) / глянуть в getUpdates.
5. Прописать в `.env` и **Railway Variables**:

```
OPS_TG_BOT_TOKEN=
OPS_TG_CHAT_ID=-100…
```

Опционально, если ветки уже созданы вручную:

```
OPS_TG_TOPIC_PAYMENTS=
OPS_TG_TOPIC_SIGNUPS=
OPS_TG_TOPIC_MARKETING=
OPS_TG_TOPIC_ERRORS=
OPS_TG_TOPIC_QUALITY=
OPS_TG_TOPIC_DEPLOYS=
```

Для уведомлений о коммитах с локальной машины (скрипт → прод API):

```
OPS_RELEASE_NOTIFY_SECRET=длинный-секрет
```

(тот же секрет в Railway Variables).

6. `/ops/bot` → блок «Ops-чат» → **Создать ветки и тест**. В каждой теме должно появиться «Ветка подключена» (включая **Деплои**).
7. Деплой Railway после переменных (web-процесс поднимает планировщик дайджеста).

Если `OPS_TG_BOT_TOKEN` пуст, код возьмёт продуктовый `TELEGRAM_BOT_TOKEN` — лучше не смешивать: продуктовый бот в staff-чате ловит лишние апдейты.

## Поведение

- Оплата: после `fulfillPaidTopup` (Cashera webhook).
- Регистрация: новый Telegram-юзер (`findOrCreateTelegramUser`) и web `/register`.
- Ошибки: единая точка `reportOpsError`.
- КК: dislike → confirm → топик «Контроль качества».
- Деплои:
  - **коммит** — `node scripts/ops-notify-release.mjs --kind commit` (после `git push`; пишет `infra/release-meta.json`);
  - **деплой** — `railway up --detach --no-gitignore` (без `--no-gitignore` gitignore выкидывает release-meta; секреты режет `.railwayignore`). Уведомление «Деплой» — при старте web (дедуп по sha). Запасной ручной вызов: `node scripts/ops-notify-release.mjs --kind deploy`.
- Дайджест: `instrumentation.ts` + `tg:bot`, слоты МСК, дедуп по `data/ops-telegram.json` (volume Railway). Окно: 00–07 / 07–15 / 15–00. Если процесс лежал — догон в пределах 10 часов.
- Id тем пишутся в `data/ops-telegram.json`, не в git.

## Локально

```bash
cd peachbitch
npx tsx scripts/ops-telegram-bootstrap.ts
node scripts/ops-notify-release.mjs --kind commit
```
