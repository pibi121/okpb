#!/bin/bash
# Full Klein character LoRA train pipeline (musubi-tuner)
set -uo pipefail
export PATH=/usr/bin:/bin:/usr/local/bin
export PYTHONUNBUFFERED=1
export HF_HOME=/work/hf_cache
export PYTHONPATH="/work/train/musubi-tuner/src:${PYTHONPATH:-}"

LOG=/work/loras_out/olh_person_klein_train.log
PIDF=/work/loras_out/olh_person_klein_train.pid
mkdir -p /work/loras_out /work/datasets/olh_person_klein/cache /work/train/models

DIT=/work/train/models/flux-2-klein-base-9b-fp8.safetensors
PART=${DIT}.part
VAE=/work/train/models/flux2-vae.safetensors
TE=/work/train/models/qwen_3_8b_fp8mixed.safetensors
DS=/work/train/olh_person_klein_dataset.toml
OUTDIR=/work/loras_out/olh_person_klein
OUTNAME=olh_person_klein
EXPECT_MIN=9000000000

log(){ echo "[$(date +%H:%M:%S)] $*" | tee -a "$LOG"; }
echo "===== RESTART $(date -Is) pid=$$ =====" >> "$LOG"
echo $$ > "$PIDF"
log "WAITER_START pid=$$"

promote_part() {
  if [ -f "$PART" ]; then
    sz=$(stat -c%s "$PART")
    if [ "$sz" -ge "$EXPECT_MIN" ]; then
      mv -f "$PART" "$DIT"
      log "PROMOTED_PART $sz"
      return 0
    fi
  fi
  return 1
}

# Wait for DiT (up to ~3h)
for i in $(seq 1 360); do
  if [ -f "$DIT" ] && [ "$(stat -c%s "$DIT")" -ge "$EXPECT_MIN" ]; then
    log "DIT_OK $(stat -c%s "$DIT")"
    break
  fi
  if promote_part; then
    log "DIT_OK $(stat -c%s "$DIT")"
    break
  fi
  sz=$(stat -c%s "$PART" 2>/dev/null || echo 0)
  log "WAIT_DIT $i size=$sz"
  sleep 30
done

if [ ! -f "$DIT" ] || [ "$(stat -c%s "$DIT")" -lt "$EXPECT_MIN" ]; then
  promote_part || true
fi
if [ ! -f "$DIT" ] || [ "$(stat -c%s "$DIT")" -lt "$EXPECT_MIN" ]; then
  log "DIT_MISSING size=$(stat -c%s "$DIT" 2>/dev/null || echo 0)"
  exit 2
fi

ln -sfn /work/ComfyUI/models/vae/flux2-vae.safetensors "$VAE"
ln -sfn /work/ComfyUI/models/text_encoders/qwen_3_8b_fp8mixed.safetensors "$TE"

# Env marker (optional if deps already in comfy venv)
for i in $(seq 1 30); do
  if grep -q ENV_OK /work/KLEIN_MUSUBI_ENV.log 2>/dev/null; then
    log "ENV_READY"
    break
  fi
  # smoke import
  if /work/ai/venv/bin/python -c 'import sys; sys.path.insert(0,"/work/train/musubi-tuner/src"); import musubi_tuner, toml, voluptuous' 2>/dev/null; then
    echo "[$(date +%H:%M:%S)] ENV_OK" >> /work/KLEIN_MUSUBI_ENV.log
    log "ENV_READY_SMOKE"
    break
  fi
  log "WAIT_ENV $i"
  sleep 10
done

export PATH="/work/ai/venv/bin:/usr/bin:/bin"
PY=/work/ai/venv/bin/python
ACC=/work/ai/venv/bin/accelerate
cd /work/train/musubi-tuner

log "STOP_COMFY"
pkill -f '/work/ai/venv/bin/python main.py' || true
pkill -f 'python main.py --listen' || true
sleep 5
nvidia-smi --query-gpu=memory.used,memory.free --format=csv,noheader | tee -a "$LOG" || true

log "CACHE_LATENTS"
set +e
$PY src/musubi_tuner/flux_2_cache_latents.py \
  --dataset_config "$DS" \
  --vae "$VAE" \
  --vae_dtype bf16 \
  --model_version klein-base-9b \
  2>&1 | tee -a "$LOG"
rc_lat=$?
set -e
if [ "$rc_lat" -ne 0 ]; then
  log "CACHE_LATENTS_FAIL rc=$rc_lat"
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
rc_te=$?
set -e
if [ "$rc_te" -ne 0 ]; then
  log "CACHE_TE_FAIL rc=$rc_te — retry without fp8_text_encoder"
  set +e
  $PY src/musubi_tuner/flux_2_cache_text_encoder_outputs.py \
    --dataset_config "$DS" \
    --text_encoder "$TE" \
    --batch_size 1 \
    --model_version klein-base-9b \
    2>&1 | tee -a "$LOG"
  rc_te=$?
  set -e
  if [ "$rc_te" -ne 0 ]; then
    log "CACHE_TE_FAIL2 rc=$rc_te"
    exit 4
  fi
fi
log "CACHE_TE_OK"

mkdir -p "$OUTDIR"
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
rc_tr=$?
set -e
if [ "$rc_tr" -ne 0 ]; then
  log "TRAIN_FAIL rc=$rc_tr"
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
