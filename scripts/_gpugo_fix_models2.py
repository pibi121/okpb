#!/usr/bin/env python3
import os
import paramiko

PASSWORD = os.environ.get("GPUGO_PASS") or "C5FdcIQ5"


def main():
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(
        "95.165.71.177",
        port=42010,
        username="root",
        password=PASSWORD,
        timeout=60,
        allow_agent=False,
        look_for_keys=False,
    )
    cmd = r'''
python3 << 'PY'
import json, glob
for p in sorted(set(glob.glob('/workspace/user/default/workflows/*ALLinONE*.json'))):
  d=json.load(open(p,encoding='utf-8'))
  changed=0
  for n in d.get('nodes') or []:
    t=n.get('type')
    w=n.get('widgets_values')
    # bypass empty/broken lora loaders
    if t in ('LoraLoader','LoraLoaderModelOnly') and isinstance(w, list):
      name = w[0] if w else ''
      if not name or name in ('', 'None', 'none') or 'nipple' in str(name).lower():
        if n.get('mode') != 4:
          n['mode']=4; changed+=1
          print('bypass LoraLoader', n.get('id'), name)
    # ensure UNET/VAE
    if t=='UNETLoader' and isinstance(w,list) and w and w[0]!='z_image_turbo_bf16.safetensors':
      print('fix UNET', w[0]); w[0]='z_image_turbo_bf16.safetensors'; changed+=1
    if t=='VAELoader' and isinstance(w,list) and w and w[0]!='ae.safetensors':
      print('fix VAE', w[0]); w[0]='ae.safetensors'; changed+=1
    # report still-referenced missing files on active nodes
    if n.get('mode',0) not in (2,4) and isinstance(w, list):
      for x in w:
        if isinstance(x,str) and (x.endswith('.pt') or x.endswith('.safetensors') or x.endswith('.pth')):
          if any(s in x for s in ('pussy','nipples_yolo','ultraflux','fp8','ema_vae','Detailed_nipple')):
            print('ACTIVE missing ref', n.get('id'), t, x)
  if changed:
    json.dump(d, open(p,'w',encoding='utf-8'), ensure_ascii=False)
  print(p, 'extra_changes', changed)
  # summary active model refs
  print('ACTIVE core:')
  for n in d['nodes']:
    if n.get('mode',0) in (2,4): continue
    t=n.get('type')
    if t in ('UNETLoader','VAELoader','CLIPLoader','LoraLoader','UltralyticsDetectorProvider','SeedVR2LoadVAEModel','SeedVR2LoadDiTModel'):
      print(' ', n['id'], t, n.get('widgets_values'))
PY
'''
    _, stdout, stderr = c.exec_command(cmd, timeout=60)
    print(stdout.read().decode(errors="replace"))
    print(stderr.read().decode(errors="replace"))
    c.close()


if __name__ == "__main__":
    main()
