# Если нода LoRA сразу «выполнена» — что делать

Мгновенный статус = train **не работал**. Ниже диагностика и запасной запуск через терминал (лучше для Pony/SDXL).

## 1. Диагностика (скопируй блок целиком в Terminal Jupyter)

```bash
echo "=== DATASETS ==="
ls -la /workspace/datasets
echo "=== FOLDERS ==="
find /workspace/datasets -maxdepth 2 -type d
echo "=== FILES IN FIRST TRAIN FOLDER ==="
d=$(find /workspace/datasets -maxdepth 1 -type d -name '[0-9]*_*' | head -1)
echo "Using: $d"
ls -la "$d" | head -30
echo "=== COUNT ==="
echo -n "images: "; find "$d" -type f \( -iname '*.jpg' -o -iname '*.jpeg' -o -iname '*.png' -o -iname '*.webp' \) | wc -l
echo -n "txt:    "; find "$d" -type f -name '*.txt' | wc -l
echo "=== LORAS ==="
ls -lah /workspace/models/loras 2>/dev/null || true
echo "=== GPU ==="
nvidia-smi --query-gpu=utilization.gpu,memory.used,memory.total --format=csv
```

### Как должно быть

```text
/workspace/datasets/
  10_olh_person/     ← имя: ЧИСЛО_слово
    01.jpg
    01.txt
    02.jpg
    02.txt
    ...
```

- `data_path` в ноде = `/workspace/datasets` (родитель)
- картинок ≥ 5, txt столько же сколько картинок

Если папка `char1` без числа — переименуй:

```bash
mv /workspace/datasets/char1 /workspace/datasets/10_olh_person
```

## 2. Почему нода LJRE часто «сразу готова» на Pony

Пакет **Lora-Training-in-Comfy** заточен под **SD 1.5**, автор **не гарантирует SDXL/Pony**.  
На Pony он может «успешно» завершиться за секунду без обучения.

Для peachbitch нужен train под **SDXL/Pony** → надёжнее **kohya sd-scripts** в терминале.

## 3. Запасной путь: kohya (SDXL LoRA) — один раз поставить

В Terminal Jupyter:

```bash
cd /workspace
git clone --depth 1 https://github.com/kohya-ss/sd-scripts.git
cd sd-scripts
python -m venv venv
source venv/bin/activate
pip install -U pip
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu124
pip install -r requirements.txt
accelerate config default
```

(Если `cu124` не встанет — попробуй `cu121`.)

## 4. Конфиг и запуск train

Подставь своё имя папки, если не `10_olh_person`:

```bash
mkdir -p /workspace/models/loras /workspace/datasets/oh_toml

cat > /workspace/datasets/oh_toml/olh_person.toml << 'EOF'
[general]
enable_bucket = true

[[datasets]]
resolution = 1024
batch_size = 1

  [[datasets.subsets]]
  image_dir = "/workspace/datasets/10_olh_person"
  caption_extension = ".txt"
  num_repeats = 10
EOF
```

Запуск (пока идёт — `nvidia-smi` должен показать нагрузку):

```bash
cd /workspace/sd-scripts
source venv/bin/activate

accelerate launch --num_cpu_threads_per_process 2 sdxl_train_network.py \
  --pretrained_model_name_or_path="/workspace/models/checkpoints/ponyDiffusionV6XL_v6StartWithThisOne.safetensors" \
  --dataset_config="/workspace/datasets/oh_toml/olh_person.toml" \
  --output_dir="/workspace/models/loras" \
  --output_name="olh_person_lora" \
  --save_model_as=safetensors \
  --network_module=networks.lora \
  --network_dim=16 \
  --network_alpha=16 \
  --learning_rate=1e-4 \
  --max_train_epochs=10 \
  --mixed_precision=bf16 \
  --save_every_n_epochs=10 \
  --cache_latents \
  --optimizer_type=AdamW8bit \
  --sdpa \
  --gradient_checkpointing
```

> Не используй `--xformers`, если нет модуля xformers. На RTX 5090 чаще ставь `--sdpa`.
>
> Если увидишь `CUDA capability sm_120 is not compatible` и train падает на GPU — нужен PyTorch nightly под Blackwell (CUDA 12.8+). ComfyUI на том же сервере уже мог работать на другом venv.

Имя checkpoint, если другое:

```bash
ls /workspace/models/checkpoints
```

подставь точный файл в `--pretrained_model_name_or_path=...`.

## 5. Как понять, что train РЕАЛЬНО идёт

В **втором** терминале каждые 10 сек:

```bash
nvidia-smi
```

- Util **> 0%**, память растёт → ок, жди 30–120 мин  
- Util **0%**, сразу снова промпт `root@...` с ошибкой → пришли последние 30 строк лога  

Готовый файл:

```bash
ls -lh /workspace/models/loras/olh_person_lora.safetensors
```

## 6. После train — тест в ComfyUI

1. F5  
2. Схема генерации: Checkpoint Pony → **Load LoRA** `olh_person_lora` strength 0.8  
3. Промпт начинается с `olh_person, ...`  
4. 3 картинки — сравни лицо с фото
