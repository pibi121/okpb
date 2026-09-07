#!/bin/bash
pkill -f 'curl.*flux-2-klein' || true
pkill -f curl_klein_resume || true
sleep 2
nohup bash /tmp/curl_klein_resume2.sh >> /work/REDOWNLOAD_KLEIN_CURL.nohup 2>&1 &
echo "PID:$!"
sleep 10
grep -E 'RESUME2|CURL_RESUME2|SSL|Resuming|curl:|curl_exit' /work/REDOWNLOAD_KLEIN_CURL.log | tail -25
echo '---'
ls -lh /work/ComfyUI/models/diffusion_models/flux-2-klein-9b-fp8.safetensors.part 2>/dev/null || true
ps -o pid,etime,cmd -C curl 2>/dev/null | head -5 || true
