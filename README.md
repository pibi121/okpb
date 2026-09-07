# peachbitch — Peach lab

Личный кабинет для тестов и сборки пресетов (закрытая бета позже).

## Запуск

```bash
npm install
npx prisma migrate dev
npm run stack
```

`npm run stack` поднимает: Comfy+Ollama на Metalnode → SSH-туннель (:8188/:11434) с автопереподключением → Next.js на :3000.

Открой http://localhost:3000 → регистрация (18+) → **/peach**

Отдельно (если нужно вручную):

```bash
npm run tunnel   # только туннель
npm run dev      # только Next
```

## Peach кабинет

| Вкладка | Что |
|---------|-----|
| **Фото** | поза/стиль + Lookbook/LoRA → still (пока mock) → галерея |
| **Видео** | 1 клип или мини-фильм 6×5с (+ музыка flag) |
| **Галерея** | edit / regen / Оживить / удалить |
| **Персонажи** | Lookbook (enums) + статус LoRA |
| **Пресеты** | builtin из `presets/prompt_presets.json` + твои сохранения |
| **Соцсети** | stub |

BITCH (блок-схема) спрятан в `/scenarios` до после беты.

Сейчас: mock если Comfy недоступен; при живом туннеле **Krea** пишет PNG в `data/gallery/` и бэкапит БД. См. [`docs/RESTORE-METALNODE.md`](docs/RESTORE-METALNODE.md).

```bash
npm run stack    # рекомендовано перед тестами
```
