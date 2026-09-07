# Тест озвучки и липсинка (Metalnode)

Дата: 2026-08-07  
База видео: **Remix → RIFE** (без SeedVR2).

## Что установлено

| Задача | Инструмент | Статус |
|--------|------------|--------|
| Стоны / хлюпы / шлепки (SFX) | **MMAudio** | готово |
| Загрузка/склейка видео | **ComfyUI-VideoHelperSuite** (VHS) | готово |
| Речь + рот (lipsync) | **MuseTalk** + sample TTS | модели стоят; ноды есть |
| Пробная реплика | `/work/ComfyUI/input/test_dialogue_moan.mp3` | готово |

Workflow-пример MMAudio в Comfy: **`mmaudio_test`**.

---

## Подключение

```bash
ssh -i "path/to/metalnode_id_ed25519 (2).txt" -L 8188:localhost:8188 root@$METALNODE_HOST -p 22022
```

Открой http://127.0.0.1:8188 → **Ctrl+F5**.

---

## Тест 1 — озвучка секса / foley (MMAudio) ★ начни с этого

Цель: немое Remix-видео получает синхронные звуки действия.

### Шаги

1. Возьми готовый клип Remix(+RIFE) из `output/video/` **или** прогони `video-remix-rife`.
2. В Comfy: Workflows → открой **`mmaudio_test`**  
   (или собери вручную ниже).
3. **Load Video / VHS_LoadVideo** — укажи свой mp4 (кадры IMAGE).
4. Проверь загрузчики:
   - **MMAudioModelLoader** → `mmaudio_large_44k_v2_fp16.safetensors`
   - **MMAudioFeatureUtilsLoader** → VAE `mmaudio_vae_44k_fp16` + Synchformer + CLIP `apple_DFN5B-…`
   - BigVGAN при первом запуске может скачаться сам (подожди).
5. **MMAudioSampler**:
   - images ← кадры видео  
   - prompt (positive), например:  
     `sex sounds, wet sounds, moaning, body slap, bed creak, realistic foley`  
   - negative, например:  
     `music, song, speech, narration, voiceover`  
     (если нужны **слова** — убери `speech` из negative и смотри Тест 2)
   - duration ≈ длина клипа в секундах (или как в примере)
6. **PreviewAudio** / Save Audio — послушай.
7. Сложи звук с видео: нода mux / Video Combine с audio **или** скачай wav + склей в плеере.

### Успех, если
Слышны синхронные «мокрые»/ударные звуки под движение, без громкой музыки.

### Если ошибка
- Ctrl+F5, модели в `models/mmaudio/`  
- Первый прогон дольше (BigVGAN)  
- Лог: `/work/ComfyUI/user/comfyui_8188.log`

---

## Тест 2 — речь / стоны голосом + губы (MuseTalk)

Цель: на **том же** клипе рот двигается под аудио («стонет / говорит, пока…»).

### Подготовка аудио
Уже лежит: **`input/test_dialogue_moan.mp3`**  
(фраза: *Oh yes... right there... don't stop...*)  
Можно заменить своим wav/mp3 через Upload.

### Шаги (упрощённо)

1. Load Video — тот же Remix-клип (лучше лицо крупно, фронт).
2. Load Audio — `test_dialogue_moan.mp3`.
3. Ноды MuseTalk (поиск `MuseTalk` / `whisper`):
   - **whisper_to_features** ← аудио + fps видео  
   - **UNETLoader_MuseTalk** (веса уже в `models/musetalk/`)  
   - VAE: обычный **SD1.5 VAE** (не Wan VAE) — если нет `sd-vae-ft-mse`, поставь через Manager  
   - **muse_talk_sampler** (если видна в списке) ← model + vae + whisper + images + masked faces  
4. На выходе — кадры с новым ртом → Create Video → Save.
5. Звук: mux исходное audio + (опционально) MMAudio foley отдельно.

### Важно
- Lipsync лучше на **крупном стабильном лице**; при сильном моушне рот может плыть.  
- MuseTalk сложнее MMAudio: нужны masked faces (лицо/маска). Если ноды не хватает — сначала закрой Тест 1, lipsync добьём отдельно.  
- Не гоняй Remix + MMAudio + MuseTalk одним Queue на старте — по очереди.

### Успех, если
Губы двигаются в такт `test_dialogue_moan.mp3`, тело остаётся от Remix.

---

## Рекомендуемый порядок проверки сегодня

1. Ctrl+F5  
2. Тест 1 MMAudio на 5-сек клипе (~10–20 мин с учётом первой загрузки)  
3. Если ок — Тест 2 lipsync на том же клипе + sample mp3  
4. Потом: свой текст через edge-tts / свой wav

---

## Связка продукта (актуально)

```
Flux+LoRA still → Remix → RIFE → MMAudio (foley)
                              └→ (+ TTS + MuseTalk) если нужна речь/рот
```
