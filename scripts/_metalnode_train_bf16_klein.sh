#!/bin/bash
# Train Klein LoRA on dequantized BF16 DiT (+ optional --fp8_base --fp8_scaled)
set -uo pipefail
export PATH="/work/ai/venv/bin:/usr/bin:/bin"
export PYTHONUNBUFFERED=1
export HF_HOME=/work/hf_cache
export PYTHONPATH="/work/train/musubi-tuner/src:${PYTHONPATH:-}"
export HF_HUB_OFFLINE=1
export TRANSFORMERS_OFFLINE=1

LOG=/work/loras_out/olh_person_klein_train.log
PIDF=/work/loras_out/olh_person_klein_train.pid
DIT=/work/train/models/flux-2-klein-base-9b-bf16.safetensors
VAE=/work/train/models/flux2-vae.safetensors
TE=/work/train/models/qwen3-8b/model-00001-of-00005.safetensors
DS=/work/train/olh_person_klein_dataset.toml
OUTDIR=/work/loras_out/olh_person_klein
OUTNAME=olh_person_klein

log(){ echo "[$(date +%H:%M:%S)] $*" | tee -a "$LOG"; }
echo "===== TRAIN_BF16 $(date -Is) pid=$$ =====" >> "$LOG"
echo $$ > "$PIDF"
log "TRAIN_BF16_START pid=$$"

for pat in run_klein_lora_train.sh continue_klein_te_train.sh train_only_klein.sh train_bf16_klein.sh; do
  for p in $(pgrep -f "$pat" || true); do
    if [ "$p" != "$$" ] && [ "$p" != "$PPID" ]; then kill "$p" 2>/dev/null || true; fi
  done
done
for p in $(pgrep -f 'flux_2_train_network.py' || true); do
  if [ "$p" != "$$" ]; then kill "$p" 2>/dev/null || true; fi
done

ln -sfn /work/ComfyUI/models/vae/flux2-vae.safetensors "$VAE"

# Wait for BF16 DiT
for i in $(seq 1 120); do
  if [ -f "$DIT" ] && [ "$(stat -c%s "$DIT")" -gt 15000000000 ]; then
    log "DIT_BF16_OK $(stat -c%s "$DIT")"
    break
  fi
  log "WAIT_BF16 $i size=$(stat -c%s "$DIT" 2>/dev/null || echo 0)"
  sleep 20
done
if [ ! -f "$DIT" ] || [ "$(stat -c%s "$DIT")" -le 15000000000 ]; then
  log "DIT_BF16_MISSING"; exit 2
fi
if [ ! -f "$TE" ]; then log "TE_MISSING"; exit 4; fi

ACC=/work/ai/venv/bin/accelerate
cd /work/train/musubi-tuner

log "STOP_COMFY"
pkill -f '/work/ai/venv/bin/python main.py' || true
pkill -f 'python main.py --listen' || true
sleep 4
nvidia-smi --query-gpu=memory.used,memory.free --format=csv,noheader | tee -a "$LOG" || true

mkdir -p "$OUTDIR"
log "TRAIN_START_BF16_FP8SCALED"
set +e
$ACC launch --num_cpu_threads_per_process 1 --mixed_precision bf16 \
  src/musubi_tuner/flux_2_train_network.py \
  --model_version klein-base-9b \
  --dit "$DIT" \
  --vae "$VAE" \
  --text_encoder "$TE" \
  --dataset_config "$DS" \
  --sdpa --mixed_precision bf16 \
  --fp8_base --fp8_scaled \
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
  log "TRAIN_FAIL rc=$rc_tr — retry without fp8 (full bf16)"
  set +e
  $ACC launch --num_cpu_threads_per_process 1 --mixed_precision bf16 \
    src/musubi_tuner/flux_2_train_network.py \
    --model_version klein-base-9b \
    --dit "$DIT" \
    --vae "$VAE" \
    --text_encoder "$TE" \
    --dataset_config "$DS" \
    --sdpa --mixed_precision bf16 \
    --timestep_sampling flux2_shift --weighting_scheme none \
    --optimizer_type adamw8bit --learning_rate 1e-4 \
    --gradient_checkpointing --blocks_to_swap 16 \
    --max_data_loader_n_workers 2 --persistent_data_loader_workers \
    --network_module networks.lora_flux_2 --network_dim 16 --network_alpha 16 \
    --max_train_epochs 10 --save_every_n_epochs 2 --seed 42 \
    --output_dir "$OUTDIR" --output_name "$OUTNAME" \
    2>&1 | tee -a "$LOG"
  rc_tr=$?
  set -e
  if [ "$rc_tr" -ne 0 ]; then log "TRAIN_FAIL2 rc=$rc_tr"; exit 5; fi
fi
log "TRAIN_DONE"
ls -lh "$OUTDIR" | tee -a "$LOG"

LATEST=$(ls -1t "$OUTDIR"/*.safetensors 2>/dev/null | head -1 || true)
if [ -z "$LATEST" ]; then log "NO_LORA_FILE"; exit 6; fi
cp -f "$LATEST" /work/ComfyUI/models/loras/olh_person_klein.safetensors
log "INSTALLED $LATEST -> olh_person_klein.safetensors"

log "START_COMFY"
cd /work/ComfyUI
nohup /work/ai/venv/bin/python main.py --listen --port 8188 --enable-manager >> /work/ComfyUI/user/comfyui_8188.log 2>&1 &
echo $! > /work/loras_out/comfy_restart.pid
log "ALL_DONE"
