#!/usr/bin/env bash
set -euxo pipefail
chmod +x /work/bin/start-prompt-composer.sh
supervisorctl stop ollama open-webui prompt-composer || true
pkill -f 'open-webui serve' || true
pkill -f prompt_composer_app.py || true
sleep 2
if ! pgrep -x ollama >/dev/null; then
  nohup /work/bin/start-ollama.sh >/work/logs/ollama.log 2>&1 &
  sleep 3
fi
nohup /work/bin/start-open-webui.sh >/work/logs/open-webui.log 2>&1 &
nohup /work/bin/start-prompt-composer.sh >/work/logs/prompt-composer.log 2>&1 &
sleep 15
echo '---STATUS---'
curl -s -o /dev/null -w 'ollama:%{http_code}\n' http://127.0.0.1:11434/ || true
curl -s -o /dev/null -w 'webui:%{http_code}\n' http://127.0.0.1:8080/ || true
curl -s -o /dev/null -w 'composer:%{http_code}\n' http://127.0.0.1:8090/ || true
pgrep -af 'ollama serve|open-webui|prompt_composer' || true
echo '---COMPOSER LOG---'
tail -50 /work/logs/prompt-composer.log || true
echo '---VRAM---'
nvidia-smi --query-gpu=memory.used,memory.total --format=csv,noheader || true
