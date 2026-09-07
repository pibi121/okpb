# Metalnode — Z-Image + Wan Remix

Дата: 2026-08-05  
Сервер: `root@$METALNODE_HOST` порт SSH **22026**  
GPU: RTX 5090 32GB  
ComfyUI: `/work/ComfyUI`, порт **8188**  
Модели: `/work/ComfyUI/models/`

## Подключение

```bash
ssh -i metalnode_id_ed25519 -L 8188:localhost:8188 root@$METALNODE_HOST -p 22026
```

Ключ (локально): `peachbitch/metalnode_id_ed25519` (копия из Downloads).  
После туннеля: http://127.0.0.1:8188

Статус скачивания: `/work/SETUP_STATUS.txt`  
Лог: `/work/SETUP_DOWNLOAD.log`

## Что ставится

### Картинки (Z-Image Turbo)
| Файл | Папка |
|------|--------|
| `z_image_turbo_bf16.safetensors` | `diffusion_models/` |
| `qwen_3_4b.safetensors` | `text_encoders/` |
| `ae.safetensors` | `vae/` |
| `olh_person_zimage.safetensors` (+1500/2000) | `loras/` |

### Видео (Wan Remix I2V NSFW v3)
| Файл | Папка |
|------|--------|
| `Wan2.2_Remix_NSFW_i2v_14b_high_lighting_fp8_e4m3fn_v3.0.safetensors` | `diffusion_models/` |
| `Wan2.2_Remix_NSFW_i2v_14b_low_lighting_fp8_e4m3fn_v3.0.safetensors` | `diffusion_models/` |
| `nsfw_wan_umt5-xxl_fp8_scaled.safetensors` | `text_encoders/` |
| `wan_2.1_vae.safetensors` | `vae/` |

## Как тестировать

### 1) Still
1. Templates / Blueprints → **Text to Image (Z-Image-Turbo)**  
   (или workflow `Text-to-Image-Z-Image-Turbo.json`)
2. Добавь LoRA `olh_person_zimage`, strength ~0.7–0.85  
3. Trigger в промпте: `olh_person`  
4. Queue → сохрани картинку

All-in-One JSON тоже залит, но на чистом сервере мало custom nodes — для первого теста лучше официальный blueprint.

### 2) Video (Remix)
1. Blueprints → **Image to Video (Wan 2.2)**  
2. Load Image = still с LoRA  
3. В high/low UNET выбери **Remix** high/low v3 (не stock Wan)  
4. CLIP: `nsfw_wan_umt5-xxl_fp8_scaled`  
5. VAE: `wan_2.1_vae`  
6. Шаги: **4 high + 4 low** (всего 8) — LightX2V уже вшит в Remix, не ставь отдельно LightX2V LoRA  
7. Клип ~5 сек для стабильного лица

## All-in-One missing models (установлены)

| Файл | Путь |
|------|------|
| `z-image-turbo-fp8-e4m3fn.safetensors` | `diffusion_models/` |
| `ultrafluxVAEImproved_v10.safetensors` | symlink → `vae/ae.safetensors` |
| `sam_vit_b_01ec64.pth` | `sams/` |
| `bbox/pussyV2.pt`, `bbox/nipples_yolov8s.pt` | `ultralytics/bbox/` (+ whitelist) |
| `Detailed_nipples_xl.safetensors` | `loras/` |

## Custom nodes (для Z-Image ALLinONE v2)

Установлены в `/work/ComfyUI/custom_nodes/`:

- cg-use-everywhere, ComfyUI_essentials, ComfyUI_tinyterraNodes
- ComfyUI-Impact-Pack + Impact-Subpack
- ComfyUI-post-processing-nodes, ControlAltAI-Nodes, masquerade-nodes-comfyui
- rgthree-comfy, ComfyUI-SeedVR2_VideoUpscaler, was-node-suite-comfyui
- COMFYUI_PROMPTMODELS, ComfyUI-KJNodes (Set/Get)

После установки: hard refresh UI (Ctrl+F5) и перезагрузить workflow.

## Скрипты

- `scripts/_metalnode_bootstrap.py` — upload LoRA/workflows + kick download  
- `scripts/_metalnode_poll.py` — прогресс скачивания
- `scripts/_metalnode_install_nodes_fix.py` / `_metalnode_install_kjnodes.py` — custom nodes
