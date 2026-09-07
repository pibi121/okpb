#!/bin/bash
export PATH=/usr/bin:/bin
ps -o pid,etime,cmd -C curl 2>/dev/null | head -5
ls -lah /work/train/models/ 2>/dev/null
tail -c 600 /work/KLEIN_TRAIN_SETUP.log 2>/dev/null | tr '\r' '\n' | tail -8
tail -20 /work/KLEIN_TRAIN_SETUP.nohup 2>/dev/null
ls /work/train/musubi-tuner/src/musubi_tuner 2>/dev/null | head -20
ls /work/train/musubi-tuner/*.py 2>/dev/null | head -20
