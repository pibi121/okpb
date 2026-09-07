#!/bin/bash
# GPU box: free VRAM — LLM now lives on the other Metalnode.
curl -s http://127.0.0.1:11434/api/generate -d '{"model":"gemma4-heretic","keep_alive":0}' >/dev/null 2>&1 || true
pkill -x ollama 2>/dev/null || true
pkill -f 'ollama serve' 2>/dev/null || true
pkill -f peach_watch_ollama 2>/dev/null || true
sleep 2
curl -sf -m 3 http://127.0.0.1:8188/system_stats >/dev/null && echo GPU_COMFY_OK || echo GPU_COMFY_FAIL
nvidia-smi --query-gpu=memory.used,memory.total --format=csv,noheader
