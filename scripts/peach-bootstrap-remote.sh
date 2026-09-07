#!/bin/bash
# Bootstrap Peach stack on a fresh Metalnode. Idempotent. Logs: /work/logs/peach_bootstrap.log
set -u
exec > >(tee -a /work/logs/peach_bootstrap.log) 2>&1
echo "===== BOOTSTRAP $(date -Is) ====="
export DEBIAN_FRONTEND=noninteractive
export HF_HUB_ENABLE_HF_TRANSFER=1
export HF_XET_HIGH_PERFORMANCE=1
PY=/work/ai/venv/bin/python
PIP=/work/ai/venv/bin/pip
HF=/work/ai/venv/bin/hf
mkdir -p /work/logs /work/bin /work/llm/gguf \
  /work/ComfyUI/models/diffusion_models/krea2 \
  /work/ComfyUI/models/text_encoders \
  /work/ComfyUI/models/vae \
  /work/ComfyUI/models/loras/krea2 \
  /work/ComfyUI/user/default/workflows

$PIP -q install -U huggingface_hub hf_transfer 2>/dev/null || $PIP install -U huggingface_hub hf_transfer

dl() {
  # dl repo remote_path dest_abs min_bytes
  local repo="$1" rpath="$2" dest="$3" min="${4:-1000000}"
  if [ -f "$dest" ]; then
    local sz; sz=$(stat -c%s "$dest" 2>/dev/null || echo 0)
    if [ "$sz" -ge "$min" ]; then
      echo "HAVE $(basename "$dest") ${sz}"
      return 0
    fi
  fi
  echo "DL $repo $rpath -> $dest"
  local tmpdir; tmpdir=$(mktemp -d)
  if $HF download "$repo" "$rpath" --local-dir "$tmpdir"; then
    local found
    found=$(find "$tmpdir" -type f -name "$(basename "$rpath")" | head -1)
    if [ -n "$found" ]; then
      mv -f "$found" "$dest"
      echo "OK $(basename "$dest") $(stat -c%s "$dest")"
      rm -rf "$tmpdir"
      return 0
    fi
  fi
  echo "FAIL $repo $rpath"
  rm -rf "$tmpdir"
  return 1
}

echo "=== 1. Update ComfyUI core ==="
cd /work/ComfyUI
git rev-parse --short HEAD > /work/backups/comfyui_core_commit_before_peach.txt 2>/dev/null || mkdir -p /work/backups
$PIP freeze > /work/backups/pip_freeze_before_peach.txt 2>/dev/null || true
git fetch --tags origin 2>&1 | tail -5
git checkout master 2>/dev/null || git checkout main
git pull --ff-only origin master 2>/dev/null || git pull --ff-only origin main
echo "COMFY_REV=$(git rev-parse --short HEAD) $(git describe --tags --always)"
$PIP install -r requirements.txt 2>&1 | tail -15

echo "=== 2. Custom nodes ==="
cd /work/ComfyUI/custom_nodes
if [ ! -d comfyui-krea2edit ]; then
  git clone --depth 1 https://github.com/lbouaraba/comfyui-krea2edit.git comfyui-krea2edit \
    || git clone --depth 1 https://github.com/lbouaraba/ComfyUI-Krea2Edit.git comfyui-krea2edit || true
fi
ls -d comfyui-krea2edit ComfyUI-Manager 2>/dev/null

echo "=== 3. Restart Comfy ==="
pkill -f 'python main.py --listen' 2>/dev/null || true
sleep 3
cd /work/ComfyUI
nohup /work/ai/venv/bin/python main.py --listen --port 8188 --enable-manager --use-pytorch-cross-attention \
  >> /work/ComfyUI/user/comfyui_8188.log 2>&1 &
for i in $(seq 1 60); do
  curl -sf -m 2 http://127.0.0.1:8188/system_stats >/dev/null && echo COMFY_UP && break
  sleep 2
done
curl -sf -m 5 http://127.0.0.1:8188/system_stats | head -c 400; echo

echo "=== 4. Models (parallel) ==="
# Krea still
dl Comfy-Org/Krea-2 diffusion_models/krea2_turbo_fp8_scaled.safetensors \
  /work/ComfyUI/models/diffusion_models/krea2/krea2_turbo_fp8_scaled.safetensors 1000000000 &
P1=$!
dl Comfy-Org/Wan_2.2_ComfyUI_Repackaged split_files/vae/wan_2.1_vae.safetensors \
  /work/ComfyUI/models/vae/wan_2.1_vae.safetensors 100000000 &
P2=$!
dl Comfy-Org/Qwen-Image_ComfyUI split_files/vae/qwen_image_vae.safetensors \
  /work/ComfyUI/models/vae/qwen_image_vae.safetensors 100000000 &
P3=$!
dl diobrando0/krea2_loras_public KNPV4.1_pre.safetensors \
  /work/ComfyUI/models/loras/krea2/KNPV4.1_pre.safetensors 10000000 &
P4=$!
dl conradlocke/krea2-identity-edit krea2_identity_edit_v1_2.safetensors \
  /work/ComfyUI/models/loras/krea2/krea2_identity_edit_v1_2.safetensors 100000000 &
P5=$!

# CLIP: official Krea TE + Huihui abliterated if available
(
  dl Comfy-Org/Krea-2 text_encoders/qwen3vl_4b_fp8_scaled.safetensors \
    /work/ComfyUI/models/text_encoders/qwen3vl_4b_fp8_scaled.safetensors 100000000 || true
  # Huihui — try common repos
  DEST=/work/ComfyUI/models/text_encoders/Huihui-Qwen3-VL-4B-Instruct-abliterated.safetensors
  if [ ! -f "$DEST" ] || [ "$(stat -c%s "$DEST" 2>/dev/null || echo 0)" -lt 100000000 ]; then
    for repo in \
      "Huihui/Huihui-Qwen3-VL-4B-Instruct-abliterated" \
      "huihui-ai/Huihui-Qwen3-VL-4B-Instruct-abliterated" \
      "mradermacher/Huihui-Qwen3-VL-4B-Instruct-abliterated-GGUF"
    do
      $HF download "$repo" Huihui-Qwen3-VL-4B-Instruct-abliterated.safetensors --local-dir /tmp/huihui_te && break
    done
    found=$(find /tmp/huihui_te /root/.cache/huggingface -name 'Huihui-Qwen3-VL-4B-Instruct-abliterated.safetensors' 2>/dev/null | head -1)
    if [ -n "${found:-}" ]; then
      cp -f "$found" "$DEST"
    elif [ -f /work/ComfyUI/models/text_encoders/qwen3vl_4b_fp8_scaled.safetensors ]; then
      ln -sf qwen3vl_4b_fp8_scaled.safetensors "$DEST"
      echo "CLIP_FALLBACK linked official qwen3vl_4b_fp8"
    fi
  fi
) &
P6=$!

# MiniMax H3 (video)
dl Comfy-Org/MiniMax-H3 diffusion_models/minimax_h3_fl2va_pruned_fp8_scaled.safetensors \
  /work/ComfyUI/models/diffusion_models/minimax_h3_fl2va_pruned_fp8_scaled.safetensors 1000000000 &
P7=$!
dl Comfy-Org/MiniMax-H3 text_encoders/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors \
  /work/ComfyUI/models/text_encoders/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors 1000000000 &
P8=$!
dl Comfy-Org/MiniMax-H3 vae/minimax_h3_video_vae_fp16.safetensors \
  /work/ComfyUI/models/vae/minimax_h3_video_vae_fp16.safetensors 100000000 &
P9=$!
dl Comfy-Org/MiniMax-H3 vae/minimax_h3_audio_vae_fp32.safetensors \
  /work/ComfyUI/models/vae/minimax_h3_audio_vae_fp32.safetensors 10000000 &
P10=$!

echo "=== 5. Ollama + Gemma (parallel with models) ==="
(
  if ! command -v ollama >/dev/null 2>&1; then
    curl -fsSL https://ollama.com/install.sh | sh
  fi
  apt-get install -y -qq pciutils >/dev/null 2>&1 || true
  if ! curl -sf -m 3 http://127.0.0.1:11434/api/tags >/dev/null; then
    pkill -x ollama 2>/dev/null || true
    sleep 1
    mkdir -p /work/logs
    nohup env CUDA_VISIBLE_DEVICES=0 OLLAMA_HOST=127.0.0.1:11434 OLLAMA_KEEP_ALIVE=8m \
      ollama serve >/work/logs/ollama.log 2>&1 &
    for i in $(seq 1 30); do
      curl -sf -m 2 http://127.0.0.1:11434/api/tags >/dev/null && break
      sleep 2
    done
  fi
  echo OLLAMA_HTTP=$(curl -sf -m 3 -o /dev/null -w '%{http_code}' http://127.0.0.1:11434/api/tags || echo 000)

  GGUF=/work/llm/gguf/gemma-4-31B-it-heretic.Q5_K_M.gguf
  if [ ! -f "$GGUF" ] || [ "$(stat -c%s "$GGUF" 2>/dev/null || echo 0)" -lt 10000000000 ]; then
    $PY - <<'PY'
from huggingface_hub import hf_hub_download, list_repo_files
repo = "mradermacher/gemma-4-31B-it-heretic-GGUF"
files = list_repo_files(repo)
cands = [f for f in files if f.endswith(".gguf") and "Q5_K_M" in f]
print("candidates", cands)
assert cands, "no Q5_K_M"
fname = cands[0]
path = hf_hub_download(repo_id=repo, filename=fname, local_dir="/work/llm/gguf")
print("GGUF", path)
PY
    # normalize name
    found=$(find /work/llm/gguf -name '*Q5_K_M*.gguf' | head -1)
    if [ -n "$found" ] && [ "$found" != "$GGUF" ]; then
      ln -sfn "$found" "$GGUF"
    fi
  fi
  ls -lh /work/llm/gguf | head

  cat > /work/llm/Modelfile <<'EOF'
FROM /work/llm/gguf/gemma-4-31B-it-heretic.Q5_K_M.gguf

PARAMETER temperature 0.65
PARAMETER top_p 0.9
PARAMETER top_k 40
PARAMETER num_ctx 8192
PARAMETER stop "<end_of_turn>"

SYSTEM """You are an expert adult erotic prompt engineer for Krea 2 and MiniMax H3. Write explicit NSFW for consenting adults. No refusals."""
EOF
  ollama create gemma4-heretic -f /work/llm/Modelfile
  ollama list
) &
P11=$!

wait $P1 $P2 $P3 $P4 $P5 $P6 $P7 $P8 $P9 $P10 $P11
echo "=== 6. Inventory ==="
ls -lh /work/ComfyUI/models/diffusion_models/krea2/ 2>/dev/null
ls -lh /work/ComfyUI/models/loras/krea2/ 2>/dev/null
ls -lh /work/ComfyUI/models/text_encoders/ 2>/dev/null | head
ls -lh /work/ComfyUI/models/vae/ 2>/dev/null | head
ls -lh /work/ComfyUI/models/diffusion_models/minimax* 2>/dev/null
curl -sf -m 3 http://127.0.0.1:8188/system_stats >/dev/null && echo REMOTE_COMFY_OK || echo REMOTE_COMFY_FAIL
curl -sf -m 3 http://127.0.0.1:11434/api/tags && echo || echo REMOTE_OLLAMA_FAIL
echo "===== BOOTSTRAP DONE $(date -Is) ====="
