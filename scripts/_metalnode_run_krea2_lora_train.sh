#!/bin/bash
# Train olh_person character LoRA for Krea2 (RAW train → Turbo infer)
set -uo pipefail
export PATH=/usr/bin:/bin:/usr/local/bin:/work/ai/venv/bin
export PYTHONUNBUFFERED=1
export HF_HOME=/work/hf_cache
export HF_XET_HIGH_PERFORMANCE=1
export PYTHONPATH="/work/train/musubi-tuner/src:${PYTHONPATH:-}"

LOG=/work/loras_out/olh_person_krea2_train.log
PIDF=/work/loras_out/olh_person_krea2_train.pid
mkdir -p /work/loras_out/olh_person_krea2 \
         /work/datasets/olh_person_krea2/cache \
         /work/ComfyUI/models/diffusion_models/krea2 \
         /work/ComfyUI/models/vae \
         /work/ComfyUI/models/text_encoders \
         /work/train/models

DS=/work/train/olh_person_krea2_dataset.toml
OUTDIR=/work/loras_out/olh_person_krea2
OUTNAME=olh_person_krea2

# Prefer Comfy-Org layout (shared with ComfyUI)
DIT=/work/ComfyUI/models/diffusion_models/krea2/krea2_raw_bf16.safetensors
VAE=/work/ComfyUI/models/vae/qwen_image_vae.safetensors
TE=/work/ComfyUI/models/text_encoders/qwen3vl_4b_bf16.safetensors
# fallback TE if bf16 missing
TE_FALLBACK=/work/ComfyUI/models/text_encoders/Huihui-Qwen3-VL-4B-Instruct-abliterated.safetensors

PY=/work/ai/venv/bin/python
ACC=/work/ai/venv/bin/accelerate

log(){ echo "[$(date +%H:%M:%S)] $*" | tee -a "$LOG"; }
echo "===== START $(date -Is) pid=$$ =====" >> "$LOG"
echo $$ > "$PIDF"

source /work/ai/venv/bin/activate

# --- downloads ---
dl_hf() {
  local repo="$1" file="$2" dest="$3"
  if [ -f "$dest" ] && [ "$(stat -c%s "$dest")" -gt 1000000 ]; then
    log "HAVE $(basename "$dest") $(stat -c%s "$dest")"
    return 0
  fi
  log "DOWNLOAD $repo $file"
  local tmpdir
  tmpdir=$(mktemp -d /tmp/krea2_dl_XXXX)
  if hf download "$repo" "$file" --local-dir "$tmpdir" >>"$LOG" 2>&1; then
    # find downloaded file
    local found
    found=$(find "$tmpdir" -type f -name "$(basename "$file")" | head -1)
    if [ -n "$found" ]; then
      mv -f "$found" "$dest"
      log "SAVED $dest $(stat -c%s "$dest")"
      rm -rf "$tmpdir"
      return 0
    fi
  fi
  log "DOWNLOAD_FAIL $repo $file"
  rm -rf "$tmpdir"
  return 1
}

dl_hf Comfy-Org/Krea-2 diffusion_models/krea2_raw_bf16.safetensors "$DIT" || exit 10
dl_hf Comfy-Org/Qwen-Image_ComfyUI split_files/vae/qwen_image_vae.safetensors "$VAE" \
  || dl_hf Comfy-Org/Qwen-Image-Edit_ComfyUI split_files/vae/qwen_image_vae.safetensors "$VAE" \
  || exit 11
dl_hf Comfy-Org/Qwen3-VL text_encoders/qwen3vl_4b_bf16.safetensors "$TE" \
  || dl_hf Comfy-Org/Krea-2 text_encoders/qwen3vl_4b_bf16.safetensors "$TE" \
  || true

if [ ! -f "$TE" ] || [ "$(stat -c%s "$TE")" -lt 1000000 ]; then
  if [ -f "$TE_FALLBACK" ]; then
    TE="$TE_FALLBACK"
    log "USING_TE_FALLBACK $TE"
  else
    log "TE_MISSING"
    exit 12
  fi
fi

# dataset toml
cp -f /work/tmp_krea/olh_person_krea2_dataset.toml "$DS" 2>/dev/null || true
if [ ! -f "$DS" ]; then
  cat > "$DS" <<'EOF'
[general]
resolution = [1024, 1024]
caption_extension = ".txt"
batch_size = 1
enable_bucket = true
bucket_no_upscale = false

[[datasets]]
image_directory = "/work/datasets/olh_person_klein/images"
cache_directory = "/work/datasets/olh_person_krea2/cache"
num_repeats = 10
EOF
fi

# free VRAM
log "STOP_COMFY"
pkill -f 'python main.py --listen' || true
pkill -f '/work/ai/venv/bin/python main.py' || true
sleep 5
nvidia-smi --query-gpu=memory.used,memory.free --format=csv,noheader | tee -a "$LOG" || true

cd /work/train/musubi-tuner

log "CACHE_LATENTS"
set +e
$PY src/musubi_tuner/krea2_cache_latents.py \
  --dataset_config "$DS" \
  --vae "$VAE" \
  2>&1 | tee -a "$LOG"
rc_lat=$?
set -e
if [ "$rc_lat" -ne 0 ]; then
  log "CACHE_LATENTS_FAIL rc=$rc_lat"
  exit 3
fi
log "CACHE_LATENTS_OK"

log "CACHE_TE te=$TE"
set +e
$PY src/musubi_tuner/krea2_cache_text_encoder_outputs.py \
  --dataset_config "$DS" \
  --text_encoder "$TE" \
  --batch_size 1 \
  2>&1 | tee -a "$LOG"
rc_te=$?
set -e
if [ "$rc_te" -ne 0 ]; then
  log "CACHE_TE_FAIL rc=$rc_te"
  exit 4
fi
log "CACHE_TE_OK"

log "TRAIN_START"
set +e
$ACC launch --num_cpu_threads_per_process 1 --mixed_precision bf16 \
  src/musubi_tuner/krea2_train_network.py \
  --dit "$DIT" \
  --vae "$VAE" \
  --dataset_config "$DS" \
  --sdpa --mixed_precision bf16 \
  --timestep_sampling krea2_shift --weighting_scheme none \
  --optimizer_type adamw8bit --learning_rate 1e-4 --gradient_checkpointing \
  --max_data_loader_n_workers 2 --persistent_data_loader_workers \
  --network_module networks.lora_krea2 --network_dim 32 --network_alpha 32 \
  --max_train_epochs 12 --save_every_n_epochs 2 --seed 42 \
  --output_dir "$OUTDIR" --output_name "$OUTNAME" \
  --save_precision bf16 \
  2>&1 | tee -a "$LOG"
rc_train=$?
set -e

if [ "$rc_train" -ne 0 ]; then
  log "TRAIN_FAIL rc=$rc_train"
  exit 5
fi

# promote final/latest to ComfyUI loras
LATEST=$(ls -1t "$OUTDIR"/*.safetensors 2>/dev/null | head -1 || true)
if [ -n "$LATEST" ]; then
  mkdir -p /work/ComfyUI/models/loras/krea2
  cp -f "$LATEST" /work/ComfyUI/models/loras/krea2/olh_person_krea2.safetensors
  log "PROMOTED $LATEST -> loras/krea2/olh_person_krea2.safetensors"
else
  log "NO_LORA_OUTPUT"
  exit 6
fi

log "TRAIN_DONE"
echo ALL_DONE | tee -a "$LOG"
