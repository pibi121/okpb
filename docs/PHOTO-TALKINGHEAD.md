# Photo → Talking Head (InfiniteTalk / MultiTalk)

Дата: **2026-08-08**  
Контекст: для **обычных диалоговых** сцен (как Hedra / HeyGen) хватает **фото + TTS**. Секс-SFX / Remix — отдельно, позже.

На Metalnode стоит актуальный стек kijai: **Wan 2.1 I2V + InfiniteTalk** (наследник MultiTalk в ComfyUI-WanVideoWrapper).

---

## Стек

| Шаг | Чем |
|-----|-----|
| Фото | Flux still / портрет лица (фронт) |
| Речь | Qwen3-TTS / Chatterbox → WAV |
| Оживление | **InfiniteTalk** (`MultiTalkModelLoader` + `WanVideoImageToVideoMultiTalk`) |
| База видео | Wan 2.1 I2V 14B 480p fp8 |

---

## Готовый workflow

| Где | Файл |
|-----|------|
| ПК (Desktop) | `./local/infinitetalk_READY.json` |
| Проект | `peachbitch/workflows/infinitetalk_READY.json` |
| Сервер Comfy | Workflows → **`infinitetalk_READY`** |

Уже проставлено:
- Image: `Flux2_upscale_00009_.png` (замени на свой портрет Olga)
- Audio: `tts_chatter_line.wav`
- Models: Wan2.1 I2V 480p fp8 + InfiniteTalk Single fp8 + wav2vec2 + clip_vision_h + VAE

SSH (актуально):
```bash
ssh -i "path/to/metalnode_id_ed25519 (3).txt" -L 8188:localhost:8188 root@$METALNODE_HOST -p 22026
```

---

## Тест в Comfy (10 минут)

1. http://127.0.0.1:8188 → **Ctrl+F5**
2. **Load** → `infinitetalk_READY.json` (с Desktop) **или** Workflows → **`infinitetalk_READY`**
3. **Load Image** — портрет лицом к камере (лучше крупный план)
4. **Load Audio** — `tts_chatter_line.wav` или свой TTS WAV
5. Проверь модели:
   - WanVideo Model → `Wan2_1-I2V-14B-480p_fp8_e4m3fn_scaled_KJ`
   - MultiTalk Model → `InfiniteTalk/...Single_fp8...`
   - Wav2Vec → `wav2vec2-chinese-base_fp16`
6. **Queue** (первый прогон может занять несколько минут на 5090)
7. Смотри выход VideoCombine / Preview

### Успех
- Лицо с фото узнаваемо  
- Рот двигается под речь  
- Нет полного «расплава» головы  

### Если плохо
- Красные ноды → Ctrl+F5; нужен пакет **ComfyUI-WanVideoWrapper**  
- Пустой Wav2Vec → файл в `models/wav2vec2/`  
- OOM → уменьши width/height / frame count в `WanVideoImageToVideoMultiTalk`  
- Губы слабые → чистый TTS без музыки; чуть сильнее audio guidance если есть в ноде  

---

## Модели на диске

| Файл | Путь |
|------|------|
| Wan I2V 480p | `models/diffusion_models/Wan2_1-I2V-14B-480p_fp8_e4m3fn_scaled_KJ.safetensors` (~16 GB) |
| InfiniteTalk Single | `models/diffusion_models/InfiniteTalk/Wan2_1-InfiniteTalk-Single_fp8_e4m3fn_scaled_KJ.safetensors` (~2.6 GB) |
| CLIP Vision | `models/clip_vision/clip_vision_h.safetensors` |
| Wav2Vec | `models/wav2vec2/wav2vec2-chinese-base_fp16.safetensors` |
| VAE | `models/vae/Wan2_1_VAE_bf16.safetensors` → `wan_2.1_vae` |
| Text enc | `models/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors` |

Custom node: `custom_nodes/ComfyUI-WanVideoWrapper`

---

## Связь с остальным пайплайном

```
Flux + LoRA → still
     ↓
Qwen3 / Chatterbox → WAV
     ↓
InfiniteTalk (фото+WAV) → talking clip   ← диалог / talking-head
     ↓
(опц.) RIFE

Remix I2V + RIFE → action / sex shots     ← отдельно
```

Не путать с **MuseTalk** (нужно готовое видео). Для Hedra-style диалога — этот док.

См. также: [`TTS-NATURAL.md`](./TTS-NATURAL.md), [`DIALOGUE-TEST.md`](./DIALOGUE-TEST.md).
