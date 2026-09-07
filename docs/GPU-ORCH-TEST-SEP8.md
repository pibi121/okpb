# GPU orchestrator test checklist

GPU включают **7 сентября 2026**. Как только `/api/tg/version` → `gpu.up: true` — продолжить цель оркестра (не ждать 8-го).

## Blocker (2026-09-06)

Metalnode SSH: `Permission denied (publickey)` → Railway `comfyUp: false`.
Нужен рабочий `METALNODE_SSH_KEY` / `authorized_keys` на ноде.

## When GPU is on

1. `/api/tg/version` → `gpu.up: true` (если нет — обновить ключ)
2. `/ops/load` — Metalnode online, heartbeat, эталоны
3. Фото + видео → GpuJob в оркестре
4. `/ops/errors` — карточка, полный лог, retry
5. RunPod/Vast авто-докупка (кнопки на `/ops/load`):
   - RunPod: `RUNPOD_API_KEY` + `RUNPOD_TEMPLATE_ID` + `RUNPOD_NETWORK_VOLUME_ID`
   - Vast: `VAST_API_KEY` + `VAST_TEMPLATE_HASH_ID` (или `VAST_IMAGE`)
   - Опционально dry-run: `RUNPOD_BURST_DRY_RUN=1` / `VAST_BURST_DRY_RUN=1`
