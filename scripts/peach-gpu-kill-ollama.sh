#!/bin/bash
supervisorctl stop ollama open-webui prompt-composer 2>/dev/null || true
pkill -9 -x ollama 2>/dev/null || true
pkill -9 -f 'ollama serve' 2>/dev/null || true
sleep 3
pgrep -af ollama || echo NO_OLLAMA
nvidia-smi --query-compute-apps=pid,process_name,used_memory --format=csv
nvidia-smi --query-gpu=memory.used --format=csv,noheader
