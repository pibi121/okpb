# Wan 2.2 Image-to-Video на GPUGO

Дата: 2026-08-03  
Стек still: **Z-Image Turbo + `olh_person_zimage` LoRA** → кадр  
Стек video: **Wan 2.2 I2V 14B fp8** (Apache) + LightX2V 4-step LoRA

---

## Модели (уже качаем / должны лежать)

| Файл | Папка |
|------|--------|
| `wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors` | `models/diffusion_models/` |
| `wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors` | `models/diffusion_models/` |
| `umt5_xxl_fp8_e4m3fn_scaled.safetensors` | `models/text_encoders/` |
| `wan_2.1_vae.safetensors` | `models/vae/` |
| `wan2.2_i2v_lightx2v_4steps_lora_v1_high_noise.safetensors` | `models/loras/` |
| `wan2.2_i2v_lightx2v_4steps_lora_v1_low_noise.safetensors` | `models/loras/` |

Статус на сервере: `/workspace/WAN_I2V_STATUS.txt`  
Лог качания: `/workspace/WAN_I2V_DOWNLOAD.log`

---

## Как сгенерировать первый клип

1. Сделай still в **Z-Image-ALLinONE-v2** с LoRA `olh_person_zimage` (strength ~0.7–0.85).  
2. Сохрани картинку (Save Image) — скачай или оставь в output.  
3. Ctrl+F5 в Comfy.  
4. Открой workflow **`Image-to-Video-Wan-2.2`**  
   (или Templates → **Image to Video (Wan 2.2)**).  
5. В **Load Image** — твой кадр с лицом.  
6. Промпт движения (англ.), например:  
   `olh_person, subtle head turn, soft smile, natural breathing, cinematic lighting`  
7. **Queue** — первый прогон дольше (кеш моделей).  
8. Видео появится в output / панели медиа.

LightX2V LoRA в blueprint дают **быстрый 4-step** режим — удобно для PoC.

---

## На что смотреть

- Лицо держится или «плывёт»?
- Движение естественное или дёрганое?
- Длина / разрешение ок для peachbitch?

Если лицо сильно разваливается — короче клип, меньше motion в промпте, или still ближе к фронту.

---

## Дальше после удачного клипа

1. Last-frame → следующий I2V (цепочка шотов).  
2. Склейка (`Video Stitch` blueprint уже есть).  
3. Пресет still+I2V → проводка в peachbitch (Stage C).
