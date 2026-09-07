# Metalnode reconnect + local durability

## Активный инстанс

Скопируй `infra/metalnode.local.example.json` → `infra/metalnode.local.json` и правь:

- `host` / `sshPort` / `sshKeyPath`
- Comfy всегда через туннель: `comfyUrl: http://127.0.0.1:8188`

Текущий (2026-08-14):

```powershell
ssh -i "path/to/metalnode_id_ed25519 (8).txt" -L 8188:localhost:8188 -L 8080:localhost:8080 -L 8090:localhost:8090 root@$METALNODE_HOST -p 22026
```

Или: `npm run tunnel`

## Что живёт на ПК (не пропадает с GPU)

| Путь | Содержимое |
|------|------------|
| `prisma/dev.db` | юзеры, персонажи, Lookbook, пресеты, метаданные галереи |
| `data/gallery/<userId>/` | PNG/файлы после Krea (настоящие кадры) |
| `data/backups/` | автокопии `dev-*.db` после каждой генерации |

## Восстановление после нового GPU

1. Подними инстанс Metalnode, восстанови `/work` (модели + LoRA + workflows).
2. Обнови `infra/metalnode.local.json` (host/port/key).
3. `npm run tunnel` → проверь http://127.0.0.1:8188
4. `npm run dev` → Peach кабинет уже с твоей БД и галереей.

Платформенные пресеты/история **не зависят** от GPU. Пропадают только файлы, которые остались только в `/work/ComfyUI/output` и не были скачаны (мы скачиваем сразу).

## Env

`.env`: `COMFY_URL`, `PEACH_USE_COMFY=1`. Mock: `COMFY_FORCE_MOCK=1`.
