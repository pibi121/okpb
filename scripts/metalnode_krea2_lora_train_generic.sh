#!/bin/bash
# Generic Krea2 character LoRA train (musubi-tuner).
# Env: PEACH_TRIGGER, PEACH_SLUG (optional), PEACH_EPOCHS (default 12)
set -uo pipefail
export PATH=/usr/bin:/bin:/usr/local/bin:/work/ai/venv/bin
export PYTHONUNBUFFERED=1
export HF_HOME=/work/hf_cache
export HF_XET_HIGH_PERFORMANCE=1
export PYTHONPATH="/work/train/musubi-tuner/src:${PYTHONPATH:-}"

TRIGGER="${PEACH_TRIGGER:?PEACH_TRIGGER required}"
SLUG="${PEACH_SLUG:-$TRIGGER}"
EPOCHS="${PEACH_EPOCHS:-12}"
IMG_DIR="/work/datasets/${SLUG}/images"
CACHE_DIR="/work/datasets/${SLUG}/cache"
OUTDIR="/work/loras_out/${SLUG}"
OUTNAME="${SLUG}_krea2"
LOG="/work/loras_out/${SLUG}_train.log"
PIDF="/work/loras_out/${SLUG}_train.pid"
DS="/work/train/${SLUG}_krea2_dataset.toml"
COMFY_LORA="/work/ComfyUI/models/loras/krea2/${OUTNAME}.safetensors"
MUSUBI="/work/train/musubi-tuner"

mkdir -p "$OUTDIR" "$CACHE_DIR" /work/ComfyUI/models/loras/krea2 /work/train
mkdir -p "$(dirname "$LOG")"

DIT=/work/ComfyUI/models/diffusion_models/krea2/krea2_raw_bf16.safetensors
VAE=/work/ComfyUI/models/vae/qwen_image_vae.safetensors
TE=/work/ComfyUI/models/text_encoders/qwen3vl_4b_bf16.safetensors
TE_FALLBACK=/work/ComfyUI/models/text_encoders/Huihui-Qwen3-VL-4B-Instruct-abliterated.safetensors

PY=/work/ai/venv/bin/python
ACC=/work/ai/venv/bin/accelerate

log(){ echo "[$(date +%H:%M:%S)] $*" | tee -a "$LOG"; }
: > "$LOG"
echo "===== START $(date -Is) pid=$$ trigger=$TRIGGER slug=$SLUG epochs=$EPOCHS =====" | tee -a "$LOG"
echo $$ > "$PIDF"

if [ ! -x "$PY" ]; then
  log "PYTHON_MISSING $PY"
  exit 13
fi
# shellcheck disable=SC1091
source /work/ai/venv/bin/activate

if [ ! -d "$MUSUBI" ]; then
  log "MUSUBI_MISSING $MUSUBI"
  exit 14
fi

if [ ! -d "$IMG_DIR" ]; then
  log "NO_IMAGES $IMG_DIR"
  exit 2
fi

NIMG=0
while IFS= read -r img; do
  [ -z "$img" ] && continue
  NIMG=$((NIMG + 1))
  base="${img%.*}"
  if [ ! -f "${base}.txt" ]; then
    printf '%s\n' "$TRIGGER" > "${base}.txt"
  fi
done < <(find "$IMG_DIR" -maxdepth 1 -type f \( -iname '*.png' -o -iname '*.jpg' -o -iname '*.jpeg' -o -iname '*.webp' \) | sort)

log "IMAGES $NIMG in $IMG_DIR"
if [ "$NIMG" -lt 5 ]; then
  log "TOO_FEW_IMAGES need>=5 got=$NIMG"
  exit 2
fi

if [ ! -f "$DIT" ]; then log "DIT_MISSING $DIT"; exit 10; fi
if [ ! -f "$VAE" ]; then log "VAE_MISSING $VAE"; exit 11; fi
if [ ! -f "$TE" ] || [ "$(stat -c%s "$TE" 2>/dev/null || echo 0)" -lt 1000000 ]; then
  if [ -f "$TE_FALLBACK" ]; then
    TE="$TE_FALLBACK"
    log "USING_TE_FALLBACK $TE"
  else
    log "TE_MISSING"
    exit 12
  fi
fi

cat > "$DS" <<EOF
[general]
resolution = [1024, 1024]
caption_extension = ".txt"
batch_size = 1
enable_bucket = true
bucket_no_upscale = false

[[datasets]]
image_directory = "${IMG_DIR}"
cache_directory = "${CACHE_DIR}"
num_repeats = 10
EOF
log "DATASET_TOML $DS"

log "STOP_COMFY"
pkill -f 'python main.py --listen' || true
pkill -f '/work/ai/venv/bin/python main.py' || true
sleep 5
nvidia-smi --query-gpu=memory.used,memory.free --format=csv,noheader | tee -a "$LOG" || true

cd "$MUSUBI"

log "CACHE_LATENTS"
set +e
$PY src/musubi_tuner/krea2_cache_latents.py --dataset_config "$DS" --vae "$VAE" 2>&1 | tee -a "$LOG"
rc_lat=${PIPESTATUS[0]}
set -e
if [ "$rc_lat" -ne 0 ]; then log "CACHE_LATENTS_FAIL rc=$rc_lat"; exit 3; fi
log "CACHE_LATENTS_OK"

log "CACHE_TE te=$TE"
set +e
$PY src/musubi_tuner/krea2_cache_text_encoder_outputs.py --dataset_config "$DS" --text_encoder "$TE" --batch_size 1 2>&1 | tee -a "$LOG"
rc_te=${PIPESTATUS[0]}
set -e
if [ "$rc_te" -ne 0 ]; then log "CACHE_TE_FAIL rc=$rc_te"; exit 4; fi
log "CACHE_TE_OK"

log "TRAIN_START epochs=$EPOCHS"
set +e
$ACC launch --num_cpu_threads_per_process 1 --mixed_precision bf16 \
  src/musubi_tuner/krea2_train_network.py \
  --dit "$DIT" --vae "$VAE" --dataset_config "$DS" \
  --sdpa --mixed_precision bf16 \
  --timestep_sampling krea2_shift --weighting_scheme none \
  --optimizer_type adamw8bit --learning_rate 1e-4 --gradient_checkpointing \
  --max_data_loader_n_workers 2 --persistent_data_loader_workers \
  --network_module networks.lora_krea2 --network_dim 32 --network_alpha 32 \
  --max_train_epochs "$EPOCHS" --save_every_n_epochs 2 --seed 42 \
  --output_dir "$OUTDIR" --output_name "$OUTNAME" \
  --save_precision bf16 \
  2>&1 | tee -a "$LOG"
rc_train=${PIPESTATUS[0]}
set -e
if [ "$rc_train" -ne 0 ]; then log "TRAIN_FAIL rc=$rc_train"; exit 5; fi

LATEST=$(ls -1t "$OUTDIR"/*.safetensors 2>/dev/null | head -1 || true)
if [ -n "$LATEST" ]; then
  cp -f "$LATEST" "$COMFY_LORA"
  log "PROMOTED $LATEST -> $COMFY_LORA"
else
  log "NO_LORA_OUTPUT"
  exit 6
fi

log "RESTART_COMFY"
cd /work/ComfyUI
nohup "$PY" main.py --listen --port 8188 --enable-manager >> /work/ComfyUI/user/comfyui_8188.log 2>&1 &
sleep 3

log "TRAIN_DONE"
echo ALL_DONE | tee -a "$LOG"
rm -f "$PIDF"
