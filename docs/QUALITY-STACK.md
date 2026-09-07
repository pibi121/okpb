# Качество фото/видео на Metalnode (простыми словами)

Обновлено: 2026-08-07

## Что поставили

| Для чего | Инструмент | Где |
|----------|------------|-----|
| Чётче фото | **4x-UltraSharp** | `models/upscale_models/` |
| Чётче видео + детали | **SeedVR2** (3B FP8) | `models/SEEDVR2/` + нода уже была |
| Плавнее движение | **RIFE** (Frame Interpolation) | `custom_nodes/ComfyUI-Frame-Interpolation` |

На 5090 (32 ГБ) бери **SeedVR2 3B FP8** — баланс скорость/качество.  
Старый Q4 GGUF можно не трогать (хуже качество).

---

## Порядок (рекомендуется)

```
1) Remix видео (или фото still)
2) SeedVR2 — сделать картинку чётче / больше
3) RIFE ×2 — добавить кадры → плавнее движение
4) Сохранить mp4
```

Для **только фото**: шаг 2 или простой Upscale Image + `4x-UltraSharp`.

---

## Как пользоваться в ComfyUI

Подключись:
```bash
ssh -i "path/to/metalnode_id_ed25519 (2).txt" -L 8188:localhost:8188 root@$METALNODE_HOST -p 22022
```
Открой http://127.0.0.1:8188 → **Ctrl+F5**.

### A) Фото чётче (быстро)

1. Load Image  
2. Нода **Upscale Image (using Model)**  
3. Модель: `4x-UltraSharp.pth`  
4. Save Image  

### B) Видео чётче — SeedVR2

1. Load Video → кадры  
2. **SeedVR2 (Down)Load DiT** → `seedvr2_ema_3b_fp8_e4m3fn.safetensors`  
3. **SeedVR2 (Down)Load VAE** → `ema_vae_fp16.safetensors`  
4. **SeedVR2 Video Upscaler**  
   - resolution (короткая сторона): **720** или **1080**  
   - batch_size: **5** или **9** (формула 4n+1)  
5. Собрать видео (VHS Video Combine)

Если мало VRAM — уменьши resolution / batch_size. На 5090 обычно ок.

### C) Плавнее — RIFE

1. Кадры после SeedVR2 (или сразу после Remix)  
2. Нода **RIFE VFI** (из Frame Interpolation)  
3. multiplier = **2** (в 2 раза больше кадров = плавнее)  
4. ckpt: `rife47` / `rife49` (скачается сама при первом запуске)  
5. Video Combine, fps = старый_fps × 2

---

## Важно

- Сначала генерируй Remix в **720p или меньше**, потом SeedVR2 — так быстрее и стабильнее, чем сразу 1080 в Remix.  
- RIFE не «чинит» лицо — только плавность.  
- SeedVR2 можно гонять и на одном фото (batch_size=1).
