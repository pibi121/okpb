# Тест Z-Image на GPUGO (ComfyUI)

Цель: сравнить **качество / NSFW / скорость** с UltraReal **без LoRA**.  
Лицензия Z-Image: **Apache 2.0** (коммерция OK).

Дата: 2026-08-02

---

## Что качаем (минимум для первого теста)

На 5090 бери **bf16**. Сначала достаточно **Turbo** (быстро). Если понравится — докачай **Base**.

| Файл | Куда | Размер (ориентир) |
|------|------|-------------------|
| `z_image_turbo_bf16.safetensors` | `models/diffusion_models/` | ~12 GB |
| `qwen_3_4b.safetensors` | `models/text_encoders/` | ~7 GB |
| `ae.safetensors` | `models/vae/` | ~0.3 GB (часто уже есть от Flux) |

Опционально позже:
- `z_image_bf16.safetensors` → Base (лучше для fine-tune / иногда свободнее NSFW)

### Ссылки (Hugging Face / Comfy)

- Turbo: https://huggingface.co/Tongyi-MAI/Z-Image-Turbo  
- Base: https://huggingface.co/Tongyi-MAI/Z-Image  
- Текстовый энкодер для Comfy: обычно зеркало Comfy-Org / ссылка из [доки Comfy Z-Image-Turbo](https://docs.comfy.org/tutorials/image/z-image/z-image-turbo)  
- VAE: тот же `ae.safetensors`, что у Flux (если уже лежит в `vae/` — не качай второй раз)

Официальные workflow JSON:  
https://docs.comfy.org/tutorials/image/z-image/z-image-turbo  

---

## Часть 0. Поднять машину

1. Start инстанс GPUGO (ComfyUI).  
2. Открой **Terminal** + **ComfyUI**.  
3. Убедись, что диск живой: `ls /workspace/models/`

---

## Часть 1. Обновить ComfyUI

Z-Image нужен **свежий** ComfyUI (новые ноды).

В ComfyUI:
1. **Manager** → **Update ComfyUI**  
2. Restart ComfyUI  
3. F5 в браузере  

Если Manager нет — в Terminal (путь к ComfyUI может отличаться):

```bash
cd /workspace/ComfyUI   # или где у тебя лежит ComfyUI
git pull
# перезапусти ComfyUI через панель GPUGO
```

---

## Часть 2. Скачать модели (Terminal)

Корень моделей у вас раньше: `/workspace/models/`.  
Готовые файлы для Comfy — репозиторий **Comfy-Org**.

```bash
mkdir -p /workspace/models/diffusion_models \
         /workspace/models/text_encoders \
         /workspace/models/vae

cd /workspace/models/diffusion_models
wget -c -O z_image_turbo_bf16.safetensors \
  "https://huggingface.co/Comfy-Org/z_image_turbo/resolve/main/split_files/diffusion_models/z_image_turbo_bf16.safetensors"

cd /workspace/models/text_encoders
wget -c -O qwen_3_4b.safetensors \
  "https://huggingface.co/Comfy-Org/z_image_turbo/resolve/main/split_files/text_encoders/qwen_3_4b.safetensors"

# VAE — если ae.safetensors уже есть от Flux, этот шаг можно пропустить
cd /workspace/models/vae
ls ae.safetensors 2>/dev/null || wget -c -O ae.safetensors \
  "https://huggingface.co/Comfy-Org/z_image_turbo/resolve/main/split_files/vae/ae.safetensors"
```

Проверка:

```bash
ls -lh /workspace/models/diffusion_models/z_image_turbo_bf16.safetensors
ls -lh /workspace/models/text_encoders/qwen_3_4b.safetensors
ls -lh /workspace/models/vae/ae.safetensors
```

Позже (Base, если Turbo ок по лицу, но слабый NSFW):

```bash
cd /workspace/models/diffusion_models
wget -c -O z_image_bf16.safetensors \
  "https://huggingface.co/Comfy-Org/z_image/resolve/main/split_files/diffusion_models/z_image_bf16.safetensors"
```

---

## Часть 3. Загрузить workflow

**Вариант А (проще):**  
1. ComfyUI → **Manager** → Update ComfyUI → Restart → F5.  
2. Templates / шаблоны → **Z-Image-Turbo**.  
3. Или JSON с https://docs.comfy.org/tutorials/image/z-image/z-image-turbo → перетащи в окно.

В нодах выбери:
- diffusion: `z_image_turbo_bf16.safetensors`
- text encoder: `qwen_3_4b.safetensors`
- vae: `ae.safetensors`

### Настройки Turbo (важно)

| Параметр | Значение |
|----------|----------|
| steps | **8–9** |
| cfg | **0** (официально) или **1**, если в шаблоне так; не копируй FluxGuidance=3 |
| sampler | как в шаблоне (часто `res_multistep` + `simple`) |
| размер | **1024×1024** |

CLIP type для Qwen в ручной сборке: часто **lumina2** (как пишет шаблон).

---

## Часть 4. Тест-промпты (одинаковые для Z-Image и UltraReal)

Без LoRA. Один seed на обе модели, если получится.

### T1 — портрет (качество кожи)
```text
raw photo, adult woman, portrait, natural skin texture, soft window light, detailed face, 35mm
```

### T2 — средний план
```text
raw photo, adult woman sitting on a chair, medium shot, natural skin, daylight interior
```

### T3 — NSFW (взрослый, 18+)
```text
raw photo, nude adult woman lying on a bed, full body, natural skin texture, soft bedroom light
```

Negative (если нода есть и модель её слушает):
```text
blurry, lowres, plastic skin, extra limbs, bad anatomy, deformed hands
```

Для Turbo negative может быть слабее — смотри результат.

---

## Часть 5. Контроль UltraReal (тот же день)

Твой старый Flux-граф:
- UltraReal в `diffusion_models`
- DualCLIP flux + FluxGuidance 3 + cfg 1 + steps 30–40
- Те же промпты T1–T3, **без LoRA**

Сохрани превью в папку, например:
`/workspace/compare_z_vs_ultra/`

---

## Часть 6. Критерии Go / No-go

Заполни честно:

| Критерий | Z-Image Turbo | UltraReal |
|----------|---------------|-----------|
| Кожа / «не пластик» | ? | ? |
| Лицо (без LoRA) | ? | ? |
| NSFW T3 (анатомия) | ? | ? |
| Скорость одного кадра | ? | ? |
| Лицензия для продажи | ✅ Apache | ❌ Non-Commercial |

**Go (берём в прод-план):**  
кожа/NSFW не хуже «терпимо», скорость ок → дальше **character LoRA на Z-Image**.

**No-go / доработать:**  
анатомия сыпется → попробовать **Z-Image Base** (больше steps, cfg > 0) или NSFW-файнтюн с Civitai, потом снова LoRA.

---

## Частые ошибки

| Симптом | Что сделать |
|---------|-------------|
| Нет нод / красный граф | Update ComfyUI, Restart, F5 |
| `qwen` undefined | файл в `text_encoders/`, не в `clip/` |
| Чёрный кадр / шум | неверный VAE; возьми `ae.safetensors`; steps/cfg как в Turbo-доке |
| Мыло / «пережарка» | cfg слишком высокий; для Turbo верни **0**, steps **8** |
| OOM | закрой старый Flux-процесс; или fp8-вариант Turbo |

---

## После теста напиши в чат

1. Turbo завёлся? да/нет  
2. T1/T3: лучше / хуже / паритет vs UltraReal  
3. Секунды на кадр (примерно)  

Дальше дам либо инструкцию **Base + NSFW**, либо **LoRA на Z-Image**.
