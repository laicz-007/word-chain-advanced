#!/usr/bin/env bash
# build-db.sh — 一键重建词库（三步完整链路）
# 用法（在项目根目录执行）：bash build-db.sh
# 依赖：Python3 + Node.js；第2步首次需联网下载 ECDICT/Tofu/Kyle（有缓存则离线）
set -e
cd "$(dirname "$0")"
PY=python3; command -v python3 >/dev/null 2>&1 || PY=python

echo "== 1/3 基础词库(vocab.json，用 word.csv，不联网) =="
# vocab.json 已随仓库分发；只有当它缺失、或存在源数据 word.csv 时才重建
if [ -f public/vocab.json ] && [ ! -f data/word.csv ]; then
  echo "   跳过（public/vocab.json 已在仓库中，且无 word.csv 源数据）"
elif [ -f public/vocab.json ] && [ -z "$FORCE_BUILD_SEED" ]; then
  echo "   跳过（public/vocab.json 已存在；如需重建请设 FORCE_BUILD_SEED=1）"
else
  $PY tools/build_data.py
fi

echo "== 2/3 全量词库(data/db.json，整合 ECDICT/Tofu/Kyle) =="
if [ ! -f data/ecdict.csv ]; then
  echo "   （本地无 ECDICT/Tofu 缓存，将联网下载约 80MB，请耐心等待...）"
fi
$PY tools/build_unified_db.py

echo "== 3/3 可接指数 + 过滤缩写/专名 =="
node tools/compute_chain_idx.js

echo ""
echo "✅ 词库重建完成：data/db.json"
echo "   重启服务生效：sudo systemctl restart word-chain"