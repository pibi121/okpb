#!/bin/bash
export PATH=/usr/bin:/bin
echo "=== /etc/hosts hf ==="
grep -nE 'huggingface|hf\.co|xethub|cdn' /etc/hosts || echo none
echo "=== clean hosts ==="
grep -vE 'huggingface|hf\.co|xethub' /etc/hosts > /tmp/hosts.clean
cp /tmp/hosts.clean /etc/hosts
echo "cleaned"
echo "=== resolve without hosts ==="
for h in huggingface.co us.aws.cdn.hf.co cas-bridge.xethub.hf.co cdn-lfs.huggingface.co; do
  ip=$(getent ahostsv4 "$h" | awk '{print $1; exit}')
  echo "$h -> $ip"
done
HF_IP=$(getent ahostsv4 huggingface.co | awk '{print $1; exit}')
echo "=== redirect chain ==="
curl -4 -sI -L --max-redirs 10 --resolve "huggingface.co:443:${HF_IP}" \
  "https://huggingface.co/titomatus0203/flux-2-klein-9b-fp8/resolve/main/flux-2-klein-9b-fp8.safetensors" \
  | tr -d '\r' | grep -iE '^(HTTP/|location:|content-type:|content-length:)' | head -40
echo "=== openssl CDN ==="
CDN_IP=$(getent ahostsv4 us.aws.cdn.hf.co | awk '{print $1; exit}')
echo "CDN_IP=$CDN_IP"
if [ -n "$CDN_IP" ]; then
  echo | openssl s_client -connect "${CDN_IP}:443" -servername us.aws.cdn.hf.co 2>/dev/null | openssl x509 -noout -subject -ext subjectAltName 2>/dev/null | head -20
fi
CAS_IP=$(getent ahostsv4 cas-bridge.xethub.hf.co | awk '{print $1; exit}')
echo "CAS_IP=$CAS_IP"
if [ -n "$CAS_IP" ]; then
  echo | openssl s_client -connect "${CAS_IP}:443" -servername cas-bridge.xethub.hf.co 2>/dev/null | openssl x509 -noout -subject -ext subjectAltName 2>/dev/null | head -20
fi
