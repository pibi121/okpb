#!/usr/bin/env bash
# Upload Loraholic skin detail LoRA to Metalnode Comfy.
set -euo pipefail

KEY="${PEACH_SSH_KEY:-$HOME/Downloads/metalnode_id_ed25519 (8).txt}"
HOST="${PEACH_SSH_HOST:-root@77.94.203.13}"
PORT="${PEACH_SSH_PORT:-22034}"
SRC="${1:-$HOME/Downloads/skindetails_krea2_loraholic.safetensors}"
DEST="/work/ComfyUI/models/loras/krea2/skindetails_krea2_loraholic.safetensors"

if [[ ! -f "$SRC" ]]; then
  echo "Missing LoRA: $SRC" >&2
  exit 1
fi

ssh -i "$KEY" -p "$PORT" "$HOST" "mkdir -p /work/ComfyUI/models/loras/krea2"
scp -i "$KEY" -P "$PORT" "$SRC" "$HOST:$DEST"
ssh -i "$KEY" -p "$PORT" "$HOST" "ls -lh '$DEST'"
echo "OK uploaded skin detail LoRA"
