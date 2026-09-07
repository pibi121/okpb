# GPU orchestrator test checklist

GPU включают **7 сентября 2026**. Как только `/api/tg/version` → `gpu.up: true` — продолжить цель оркестра (не ждать 8-го).

## Unblocked (2026-09-07)

Metalnode снова online:
- host `77.94.203.13`, SSH `22034`, key `metalnode_id_ed25519 (12)`
- Comfy `http://127.0.0.1:8188` → 200 / RTX 5090
- Railway: `PEACH_USE_COMFY=1`, `COMFY_FORCE_MOCK=0`, `METALNODE_*` через `scripts/railway-enable-gpu.mjs`
- Prod: `/api/tg/version` → `gpu.up: true` (build `tg-ready-v48-burst-providers`)
- Local smoke: `npx tsx scripts/tg-gpu-photo-smoke.ts` → OK (Krea2 + LoRA «Лора»)

## When GPU is on

1. [x] `/api/tg/version` → `gpu.up: true`
2. [ ] `/ops/load` — Metalnode online, heartbeat, эталоны (открой в UI под ops-логином)
3. [x] Фото → реальный Comfy (local smoke OK); видео → GpuJob в оркестре ещё проверить в TG
4. [ ] `/ops/errors` — карточка, полный лог, retry
5. [ ] RunPod/Vast авто-докупка (кнопки на `/ops/load`) — **ключи ещё не в Railway**:
   - RunPod: `RUNPOD_API_KEY` + `RUNPOD_TEMPLATE_ID` + `RUNPOD_NETWORK_VOLUME_ID`
   - Vast: `VAST_API_KEY` + `VAST_TEMPLATE_HASH_ID` (или `VAST_IMAGE`)
   - Опционально dry-run: `RUNPOD_BURST_DRY_RUN=1` / `VAST_BURST_DRY_RUN=1`
