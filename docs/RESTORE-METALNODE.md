# Metalnode reconnect + local durability

## Активный инстанс

Скопируй `infra/metalnode.local.example.json` → `infra/metalnode.local.json` и правь:

- `host` / `sshPort` / `sshKeyPath`
- Comfy всегда через туннель: `comfyUrl: http://127.0.0.1:8188`

Текущий (2026-09-07):

```powershell
ssh -i "C:\Users\Олег\Downloads\metalnode_id_ed25519 (12)" -L 8188:localhost:8188 root@77.94.203.13 -p 22034
```

Или: `npm run tunnel` (читает `infra/metalnode.local.json`).

Railway GPU enable:

```powershell
$env:METALNODE_HOST="77.94.203.13"
$env:METALNODE_SSH_PORT="22034"
$env:METALNODE_SSH_KEY_PATH="C:\Users\Олег\Downloads\metalnode_id_ed25519 (12)"
node scripts/railway-enable-gpu.mjs
```

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
5. На Railway: `node scripts/railway-enable-gpu.mjs` → дождись `/api/tg/version` → `gpu.up: true`.

Платформенные пресеты/история **не зависят** от GPU. Пропадают только файлы, которые остались только в `/work/ComfyUI/output` и не были скачаны (мы скачиваем сразу).

## Env

`.env`: `COMFY_URL`, `PEACH_USE_COMFY=1`. Mock: `COMFY_FORCE_MOCK=1`.
