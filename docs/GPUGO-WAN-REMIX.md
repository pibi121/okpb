# Wan 2.2 Remix — установка на GPUGO

Статус: **READY** (см. `/workspace/REMIX_STATUS.txt` на GPU).

## Что ставится

| Файл | Куда |
|------|------|
| `Wan2.2_Remix_NSFW_i2v_14b_high_lighting_fp8_e4m3fn_v3.0.safetensors` | `models/diffusion_models/` |
| `Wan2.2_Remix_NSFW_i2v_14b_low_lighting_fp8_e4m3fn_v3.0.safetensors` | `models/diffusion_models/` |
| `nsfw_wan_umt5-xxl_fp8_scaled.safetensors` | `models/text_encoders/` |

VAE уже есть: `wan_2.1_vae.safetensors`.

Источник: [FX-FeiHou/wan2.2-Remix](https://huggingface.co/FX-FeiHou/wan2.2-Remix) (I2V NSFW v3 fp8) + [NSFW-API/NSFW-Wan-UMT5-XXL](https://huggingface.co/NSFW-API/NSFW-Wan-UMT5-XXL).

## Место на диске

Чтобы вместить ~35 ГБ, удалено:

- `ultrarealFineTune_v4.safetensors`
- `t5xxl_fp16.safetensors`, `clip_l.safetensors`
- `z_image_bf16.safetensors` (остался **Turbo** `z_image_turbo_bf16`)

Stock Wan 2.2 I2V high/low оставлен для A/B.

## Как пользоваться

1. Найди Remix workflow (I2V).
2. Подставь high/low Remix и CLIP `nsfw_wan_umt5-xxl_fp8_scaled`.
3. Стартовый кадр — still из Z-Image + твоя LoRA.
4. Для качества лучше без LightX2V (или как рекомендует конкретный флоу).

Лог: `/workspace/REMIX_DOWNLOAD.log`
