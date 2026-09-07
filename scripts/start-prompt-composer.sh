#!/usr/bin/env bash
set -euo pipefail
source /work/ai/venv/bin/activate
export OLLAMA_BASE_URL=http://127.0.0.1:11434
export PROMPT_MODEL=gemma4-heretic
export PROMPT_PRESETS=/work/peachbitch/presets/prompt_presets.json
export PROMPT_CUSTOM_CHARS=/work/peachbitch/presets/custom_characters.json
export COMPOSER_PORT=8090
i=0
while [ "$i" -lt 60 ]; do
  if curl -sf http://127.0.0.1:11434/api/tags >/dev/null 2>&1; then
    break
  fi
  i=$((i + 1))
  sleep 2
done
exec python /work/peachbitch/scripts/prompt_composer_app.py
