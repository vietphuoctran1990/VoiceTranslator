#!/bin/bash
git add .
git commit -m "Auto update: $(date)"
git push origin main
echo "Push hoàn tất!"
