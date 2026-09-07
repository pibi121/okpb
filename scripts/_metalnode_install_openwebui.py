#!/usr/bin/env python3
"""Install Open WebUI + supervisor for Ollama, start services."""
from pathlib import Path
import sys
import paramiko

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
KEY = Path(r"C:\Users\Олег\Downloads\metalnode_id_ed25519 (6).txt")

REMOTE = r'''#!/bin/bash
set -e
export DEBIAN_FRONTEND=noninteractive

echo "=== 1. dirs ==="
mkdir -p /work/open-webui/data /work/open-webui/cache /work/bin /work/logs

echo "=== 2. start scripts ==="
cat > /work/bin/start-ollama.sh <<'SH'
#!/usr/bin/env bash
set -e
export CUDA_VISIBLE_DEVICES=0
export OLLAMA_KEEP_ALIVE=30m
export OLLAMA_HOST=127.0.0.1:11434
exec ollama serve
SH
chmod +x /work/bin/start-ollama.sh

cat > /work/bin/start-open-webui.sh <<'SH'
#!/usr/bin/env bash
set -e
source /work/ai/venv/bin/activate
export OLLAMA_BASE_URL=http://127.0.0.1:11434
export DATA_DIR=/work/open-webui/data
export HF_HOME=/work/open-webui/cache
export WEBUI_SECRET_KEY=peachbitch-local-dev-change-me
export WEBUI_AUTH=False
export ENABLE_SIGNUP=False
export WEBUI_NAME="Peachbitch Prompt Lab"
# wait for ollama
for i in $(seq 1 60); do
  curl -sf http://127.0.0.1:11434/api/tags >/dev/null 2>&1 && break
  sleep 2
done
exec open-webui serve --host 0.0.0.0 --port 8080
SH
chmod +x /work/bin/start-open-webui.sh

echo "=== 3. pip install open-webui (may take several min) ==="
/work/ai/venv/bin/pip install -q --upgrade pip
/work/ai/venv/bin/pip install -q open-webui 2>&1 | tail -5
/work/ai/venv/bin/open-webui --help >/dev/null 2>&1 && echo OPENWEBUI_CLI_OK || echo OPENWEBUI_CLI_FAIL

echo "=== 4. supervisor configs ==="
cat > /etc/supervisor/conf.d/ollama.conf <<'SUP'
[program:ollama]
command=/work/bin/start-ollama.sh
directory=/work
autostart=true
autorestart=true
startsecs=5
stdout_logfile=/work/logs/ollama.log
stderr_logfile=/work/logs/ollama.err.log
priority=10
SUP

cat > /etc/supervisor/conf.d/open-webui.conf <<'SUP'
[program:open-webui]
command=/work/bin/start-open-webui.sh
directory=/work
autostart=true
autorestart=true
startsecs=15
stdout_logfile=/work/logs/open-webui.log
stderr_logfile=/work/logs/open-webui.err.log
priority=20
SUP

supervisorctl reread
supervisorctl update
sleep 3
supervisorctl status ollama open-webui 2>/dev/null || supervisorctl status

echo "=== 5. wait for services ==="
for i in $(seq 1 45); do
  ok_o=0; ok_w=0
  curl -sf http://127.0.0.1:11434/api/tags >/dev/null 2>&1 && ok_o=1
  curl -sf http://127.0.0.1:8080 >/dev/null 2>&1 && ok_w=1
  if [ "$ok_o" = 1 ] && [ "$ok_w" = 1 ]; then
    echo "SERVICES_UP after ${i}s"
    break
  fi
  sleep 2
done

echo "=== ollama models ==="
ollama list 2>/dev/null || true

echo "=== open-webui HTTP ==="
curl -sf -o /dev/null -w "HTTP %{http_code}\n" http://127.0.0.1:8080/ || echo FAIL

echo "INSTALL_OPENWEBUI_OK"
'''

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
pkey = paramiko.Ed25519Key.from_private_key_file(str(KEY))
c.connect("77.94.203.13", port=22024, username="root", pkey=pkey, timeout=60, banner_timeout=60, allow_agent=False, look_for_keys=False)
sftp = c.open_sftp()
with sftp.file("/work/_install_openwebui.sh", "w") as f:
    f.write(REMOTE)
sftp.close()
stdin, stdout, stderr = c.exec_command(
    "nohup bash /work/_install_openwebui.sh > /work/OPENWEBUI_INSTALL.log 2>&1 & echo PID:$!",
    timeout=30,
)
print(stdout.read().decode(errors="replace"))
c.close()
print("Install started in background.")
