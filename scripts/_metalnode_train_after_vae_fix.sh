#!/bin/bash
# Fix VAE to flux2-vae and rerun cache+train (DiT already ready)
export PATH=/usr/bin:/bin:/usr/local/bin
set -uo pipefail
export PYTHONUNBUFFERED=1
export HF_HOME=/work/hf_cache
export PYTHONPATH="/work/train/musubi-tuner/src:${PYTHONPATH:-}"
export PATH="/work/ai/venv/bin:/usr/bin:/bin"

LOG=/work/loras_out/olh_person_klein_train.log
DIT=/work/train/models/flux-2-klein-base-9b-fp8.safetensors
VAE=/work/train/models/flux2-vae.safetensors
TE=/work/train/models/qwen_3_8b_fp8mixed.safetensors
DS=/work/train/olh_person_klein_dataset.toml
OUTDIR=/work/loras_out/olh_person_klein
OUTNAME=olh_person_klein
PY=/work/ai/venv/bin/python
ACC=/work/ai/venv/bin/accelerate

log(){ echo "[$(date +%H:%M:%S)] $*" | tee -a "$LOG"; }
echo "===== VAE_FIX_RESTART $(date -Is) =====" >> "$LOG"

# Use Flux2 VAE (NOT ae.safetensors / FLUX1)
ln -sfn /work/ComfyUI/models/vae/flux2-vae.safetensors "$VAE"
ln -sfn /work/ComfyUI/models/text_encoders/qwen_3_8b_fp8mixed.safetensors "$TE"
ls -lh "$DIT" "$VAE" "$TE" | tee -a "$LOG"

# Clear bad latent cache from wrong VAE
rm -rf /work/datasets/olh_person_klein/cache
mkdir -p /work/datasets/olh_person_klein/cache "$OUTDIR"

pkill -f 'run_klein_lora_train.sh' || true
pkill -f 'flux_2_cache' || true
pkill -f 'flux_2_train_network' || true
sleep 2

# Stop Comfy for VRAM
pkill -f 'python main.py --listen' || true
sleep 4
nvidia-smi --query-gpu=memory.used,memory.free --format=csv,noheader | tee -a "$LOG" || true

cd /work/train/musubi-tuner

log "CACHE_LATENTS"
set +e
$PY src/musubi_tuner/flux_2_cache_latents.py \
  --dataset_config "$DS" \
  --vae "$VAE" \
  --vae_dtype bf16 \
  --model_version klein-base-9b \
  2>&1 | tee -a "$LOG"
rc=$?
set -e
if [ "$rc" -ne 0 ]; then
  log "CACHE_LATENTS_FAIL rc=$rc"
  exit 3
fi
log "CACHE_LATENTS_OK"

log "CACHE_TE"
set +e
$PY src/musubi_tuner/flux_2_cache_text_encoder_outputs.py \
  --dataset_config "$DS" \
  --text_encoder "$TE" \
  --batch_size 1 \
  --fp8_text_encoder \
  --model_version klein-base-9b \
  2>&1 | tee -a "$LOG"
rc=$?
if [ "$rc" -ne 0 ]; then
  log "CACHE_TE_RETRY_NO_FP8"
  $PY src/musubi_tuner/flux_2_cache_text_encoder_outputs.py \
    --dataset_config "$DS" \
    --text_encoder "$TE" \
    --batch_size 1 \
    --model_version klein-base-9b \
    2>&1 | tee -a "$LOG"
  rc=$?
fi
set -e
if [ "$rc" -ne 0 ]; then
  log "CACHE_TE_FAIL rc=$rc"
  exit 4
fi
log "CACHE_TE_OK"

log "TRAIN_START"
set +e
$ACC launch --num_cpu_threads_per_process 1 --mixed_precision bf16 \
  src/musubi_tuner/flux_2_train_network.py \
  --model_version klein-base-9b \
  --dit "$DIT" \
  --vae "$VAE" \
  --text_encoder "$TE" \
  --dataset_config "$DS" \
  --sdpa --mixed_precision bf16 \
  --fp8_base --fp8_scaled --fp8_text_encoder \
  --timestep_sampling flux2_shift --weighting_scheme none \
  --optimizer_type adamw8bit --learning_rate 1e-4 \
  --gradient_checkpointing \
  --max_data_loader_n_workers 2 --persistent_data_loader_workers \
  --network_module networks.lora_flux_2 --network_dim 16 --network_alpha 16 \
  --max_train_epochs 10 --save_every_n_epochs 2 --seed 42 \
  --output_dir "$OUTDIR" --output_name "$OUTNAME" \
  2>&1 | tee -a "$LOG"
rc=$?
set -e
if [ "$rc" -ne 0 ]; then
  log "TRAIN_FAIL rc=$rc"
  exit 5
fi
log "TRAIN_DONE"
ls -lh "$OUTDIR" | tee -a "$LOG"

LATEST=$(ls -1t "$OUTDIR"/*.safetensors 2>/dev/null | head -1 || true)
if [ -z "$LATEST" ]; then
  log "NO_LORA_FILE"
  exit 6
fi
cp -f "$LATEST" /work/ComfyUI/models/loras/olh_person_klein.safetensors
log "INSTALLED $LATEST -> olh_person_klein.safetensors"

log "START_COMFY"
cd /work/ComfyUI
nohup /work/ai/venv/bin/python main.py --listen --port 8188 --enable-manager >> /work/ComfyUI/user/comfyui_8188.log 2>&1 &
echo $! > /work/loras_out/comfy_restart.pid
log "ALL_DONE"
