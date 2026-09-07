# Krea 2 на Metalnode (локальный тест)

Дата: **2026-08-13**  
SSH (актуальный):

```powershell
ssh -i "path/to/metalnode_id_ed25519 (8).txt" -L 8188:localhost:8188 root@$METALNODE_HOST -p 22026
```

## Smoke test — OK

| | |
|--|--|
| Модель | `krea2/krea2_turbo_fp8_scaled.safetensors` |
| Text encoder | `Huihui-Qwen3-VL-4B-Instruct-abliterated.safetensors` (type=`krea2`) |
| VAE | `wan_2.1_vae.safetensors` |
| Настройки | 8 steps · CFG 1.0 · euler · normal · 888×1176 |
| Время | **~19 сек** первый прогон (с загрузкой моделей) |
| Выход | `/work/ComfyUI/output/krea2/t2i_smoke_00001_.png` |

Workflow для UI: `krea2_t2i_READY.json`  
API-скрипт: `/work/bin/krea2_t2i_smoke.py`

## NSFW (KNPV LoRA) — OK

| | |
|--|--|
| LoRA **дефолт NSFW** | `loras/krea2/KNPV4.1_pre.safetensors` (V4.1) |
| Backup | `loras/krea2/KNP_v4.3_EXP.safetensors` (V4.3 EXP) |
| Strength | **1.0** (если одевает — 1.2–1.5) |
| Skin detail LoRA | `loras/krea2/skindetails_krea2_loraholic.safetensors` @ **1.2** (platform toggle, clip=0) |
| Workflow NSFW only | **`krea2_t2i_nsfw_READY.json`** |
| Workflow character+NSFW | **`krea2_t2i_olh_nsfw_READY.json`** (после трейна) |

## Character LoRA `olh_person_krea2` — ✅ готово

| | |
|--|--|
| Датасет | 25 фото `/work/datasets/olh_person_klein/images` |
| Base train | **Krea2 RAW bf16** → inference на Turbo |
| Tool | musubi-tuner, dim/alpha 32, 12 epochs (3000 steps, ~1h56) |
| Output | `loras/krea2/olh_person_krea2.safetensors` (224 MB) |
| Trigger | `olh_person` |
| Workflow | **`krea2_t2i_olh_nsfw_READY`** = character @1.0 + NSFW V4.1 @1.0 |
| Smoke | `olh_nsfw_smoke_00001_.png` (~28 сек) |

## Что лежит на сервере

```
ComfyUI/models/
├── diffusion_models/krea2/
│   ├── krea2_turbo_bf16.safetensors   (~25 GB) — как в community workflow
│   └── krea2_turbo_fp8_scaled.safetensors (~13 GB) — быстрее грузится, для тестов
├── text_encoders/
│   ├── Huihui-Qwen3-VL-4B-Instruct-abliterated.safetensors  (~8.3 GB, NSFW)
│   └── qwen3vl_4b_fp8_scaled.safetensors                    (~4.9 GB, официальный)
└── vae/
    └── wan_2.1_vae.safetensors   (уже был)
```

## Image Edit (инструкция текстом) — ✅ READY

| | |
|--|--|
| Смысл | Кадр + текст «измени …» → новый кадр с сохранением лица/сцены |
| Ноды | `comfyui-krea2edit` (`Krea2EditModelPatch` + `Krea2EditGroundedEncode`) |
| LoRA | `loras/krea2/krea2_identity_edit_v1_2.safetensors` (~1.8 GB, HF `conradlocke/krea2-identity-edit`) |
| VAE для edit | **`qwen_image_vae.safetensors`** (не wan_2.1) |
| UNET | Turbo FP8 `krea2/krea2_turbo_fp8_scaled.safetensors` |
| Настройки | 10 steps · CFG 1 · euler · simple · `ref_boost≈4` · `grounding_px=768` |
| UI workflow | **`krea2_edit_READY`** (Comfy → Workflows) |
| API smoke | `/work/bin/krea2_edit_smoke.py` |
| Smoke | `output/krea2/edit_smoke_00001_.png` — «change hair to bright red» сработал (~15 сек) |

Как в UI:
1. Load → `krea2_edit_READY`
2. В `LoadImage` — свой кадр
3. В `Krea2EditGroundedEncode` (positive) — инструкция на английском
4. Queue

API:
```bash
python3 /work/bin/krea2_edit_smoke.py \
  --src /work/ComfyUI/output/krea2/olh_nsfw_00048_.png \
  --prompt "change her hair to bright red, keep the same face, body, pose and lighting"
```

Заметки:
- Обычные правки (цвет волос, одежда, атрибуты) — **Turbo CFG1**.
- Удаление объектов / «вырежи» — лучше **Raw + CFG~3 + ~20 steps**.
- Вторая референс-картинка (person→scene) есть в community/example group 2 — пока не в READY.

## Community workflow'ы (из Telegram)

Загружены в ComfyUI → Workflows:

| Файл | Назначение | Доп. зависимости |
|------|------------|------------------|
| `krea2_t2i_community.json` | T2I Turbo + LoRA Manager + опциональный SeedVR2 upscale | Lora Manager, rgthree, KJNodes, WAS, SeedVR2 |
| `krea2_image_edit_community.json` | Image edit / identity (Krea2Edit) | `comfyui-krea2edit`, LoRA `krea2_identity_edit_v1_2`, snofs_krea |
| **`krea2_edit_READY.json`** | **Минимальный instruction-edit (проверен)** | `comfyui-krea2edit` + identity LoRA |
| `krea2_inpaint_community.json` | Inpaint через LanPaint | `lanpaint` |
| `krea2_detailer_seedvr2_community.json` | Face detailer 1–4 лица + SeedVR2 | Impact Pack, SeedVR2 |

Минимальный T2I без кастомных нод: **`krea2_t2i_READY.json`**.

## Custom nodes

Поставлены:

- `comfyui-lora-manager` (нужен `natsort` — уже в venv)
- `comfyui-krea2edit`
- `lanpaint`

После рестарта ComfyUI Lora Manager должен подхватиться.

## Важно для peachbitch

1. **LoRA персонажа с Flux не переносятся** на Krea2 — нужна отдельная тренировка на Krea2 RAW.
2. Identity Edit LoRA скачана; стилевая `snofs_krea_v1_1` из community-пака пока не нужна для READY-edit.
3. Рекомендованные настройки Turbo из community: **8 steps, CFG 1, euler/normal** (или uni_pc).
4. Для NSFW предпочтительнее abliterated encoder (`Huihui-...`), не официальный `qwen3vl_4b_*`.
5. VRAM: FP8 Turbo ~13 GB + encoder ~8 GB + VAE — на 5090 32GB нормально; BF16 тяжелее (~25 GB веса).

## Как открыть в UI

1. SSH с `-L 8188:localhost:8188`
2. http://localhost:8188
3. Load → `krea2_t2i_READY` (или community)
4. Для community: сменить UNET на `krea2/krea2_turbo_bf16.safetensors` или fp8
