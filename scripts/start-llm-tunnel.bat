@echo off
:loop
echo [llm-tunnel] connecting...
ssh.exe -i "C:\Users\Public\metalnode-llm.key" ^
  -o BatchMode=yes ^
  -o ServerAliveInterval=15 ^
  -o ServerAliveCountMax=6 ^
  -o TCPKeepAlive=yes ^
  -o StrictHostKeyChecking=accept-new ^
  -o AddressFamily=inet ^
  -L 11435:127.0.0.1:11434 ^
  -p 22026 ^
  root@77.94.203.13 ^
  "while true; do echo k; sleep 2; done"
echo [llm-tunnel] disconnected, reconnect in 5s...
timeout /t 5 /nobreak >nul
goto loop
