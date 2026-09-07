#!/bin/bash
# Continue Klein LoRA: TE cache (official Qwen3-8B) + train + install. Skip latents if present.
set -uo pipefail
export PATH=/usr/bin:/bin:/usr/local/bin
export PYTHONUNBUFFERED=1
export HF_HOME=/work/hf_cache
export PYTHONPATH="/work/train/musubi-tuner/src:${PYTHONPATH:-}"
export PATH="/work/ai/venv/bin:/usr/bin:/bin"

LOG=/work/loras_out/olh_person_klein_train.log
PIDF=/work/loras_out/olh_person_klein_train.pid
mkdir -p /work/loras_out /work/datasets/olh_person_klein/cache /work/train/models

DIT=/work/train/models/flux-2-klein-base-9b-fp8.safetensors
VAE=/work/train/models/flux2-vae.safetensors
TE_DIR=/work/train/models/qwen3-8b
DS=/work/train/olh_person_klein_dataset.toml
OUTDIR=/work/loras_out/olh_person_klein
OUTNAME=olh_person_klein
EXPECT_MIN=9000000000

log(){ echo "[$(date +%H:%M:%S)] $*" | tee -a "$LOG"; }
echo "===== CONTINUE $(date -Is) pid=$$ =====" >> "$LOG"
echo $$ > "$PIDF"
log "CONTINUE_START pid=$$"

# Kill duplicate waiters (keep self)
for p in $(pgrep -f 'run_klein_lora_train.sh|continue_klein_te_train.sh' || true); do
  if [ "$p" != "$$" ]; then
    log "KILL_DUP $p"
    kill "$p" 2>/dev/null || true
  fi
done

# Wait for DiT
for i in $(seq 1 60); do
  if [ -f "$DIT" ] && [ "$(stat -c%s "$DIT")" -ge "$EXPECT_MIN" ]; then
    log "DIT_OK $(stat -c%s "$DIT")"
    break
  fi
  log "WAIT_DIT $i"
  sleep 30
done
if [ ! -f "$DIT" ] || [ "$(stat -c%s "$DIT")" -lt "$EXPECT_MIN" ]; then
  log "DIT_MISSING"; exit 2
fi

ln -sfn /work/ComfyUI/models/vae/flux2-vae.safetensors "$VAE"

# Wait for Qwen TE dir (curl download)
for i in $(seq 1 240); do
  FIRST=""
  if [ -f /work/train/models/qwen3-8b-first.txt ]; then
    FIRST=$(cat /work/train/models/qwen3-8b-first.txt)
  fi
  if [ -z "$FIRST" ]; then
    FIRST=$(ls "$TE_DIR"/model-*-of-*.safetensors 2>/dev/null | sort | head -1 || true)
  fi
  SHARDS=$(ls "$TE_DIR"/model-*-of-*.safetensors 2>/dev/null | wc -l)
  if [ -n "$FIRST" ] && [ -f "$TE_DIR/config.json" ] && [ -f "$TE_DIR/tokenizer.json" ] && [ "$SHARDS" -ge 2 ]; then
    # Prefer all shards present if index says 5
    NEED=2
    if [ -f "$TE_DIR/model.safetensors.index.json" ]; then
      NEED=$(grep -oE 'model-[0-9]+-of-[0-9]+\.safetensors' "$TE_DIR/model.safetensors.index.json" | sort -u | wc -l)
      [ "$NEED" -lt 1 ] && NEED=2
    fi
    if [ "$SHARDS" -ge "$NEED" ]; then
      log "TE_OK shards=$SHARDS first=$FIRST"
      break
    fi
  fi
  log "WAIT_TE $i shards=${SHARDS:-0} first=${FIRST:-none}"
  sleep 30
done

FIRST=$(cat /work/train/models/qwen3-8b-first.txt 2>/dev/null || ls "$TE_DIR"/model-*-of-*.safetensors 2>/dev/null | sort | head -1)
if [ -z "$FIRST" ] || [ ! -f "$TE_DIR/config.json" ]; then
  log "TE_MISSING"; exit 4
fi
# musubi: pass first shard path (loads siblings via index)
TE="$FIRST"

PY=/work/ai/venv/bin/python
ACC=/work/ai/venv/bin/accelerate
cd /work/train/musubi-tuner

# Free GPU
log "STOP_COMFY"
pkill -f '/work/ai/venv/bin/python main.py' || true
pkill -f 'python main.py --listen' || true
sleep 5
nvidia-smi --query-gpu=memory.used,memory.free --format=csv,noheader | tee -a "$LOG" || true

# Latents already cached?
LAT_N=$(ls /work/datasets/olh_person_klein/cache/*_f2k9b.safetensors 2>/dev/null | wc -l)
if [ "$LAT_N" -ge 20 ]; then
  log "SKIP_LATENTS count=$LAT_N"
else
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
  if [ "$rc_lat" -ne 0 ]; then log "CACHE_LATENTS_FAIL rc=$rc_lat"; exit 3; fi
  log "CACHE_LATENTS_OK"
fi

log "CACHE_TE te=$TE"
set +e
# Official BF16 Qwen: do NOT use --fp8_text_encoder unless weights are FP8
$PY src/musubi_tuner/flux_2_cache_text_encoder_outputs.py \
  --dataset_config "$DS" \
  --text_encoder "$TE" \
  --batch_size 1 \
  --model_version klein-base-9b \
  2>&1 | tee -a "$LOG"
rc_te=$?
set -e
if [ "$rc_te" -ne 0 ]; then
  log "CACHE_TE_FAIL rc=$rc_te — retry with fp8_text_encoder"
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
  if [ "$rc_te" -ne 0 ]; then log "CACHE_TE_FAIL2 rc=$rc_te"; exit 4; fi
fi
log "CACHE_TE_OK"

mkdir -p "$OUTDIR"
log "TRAIN_START"
set +e
# Training: DiT is fp8; TE path still required by API but outputs cached
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
if [ "$rc_tr" -ne 0 ]; then log "TRAIN_FAIL rc=$rc_tr"; exit 5; fi
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
