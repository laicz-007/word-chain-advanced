#!/usr/bin/env bash
# build-db.sh — 一键重建词库（三步完整链路）
# 用法（在项目根目录执行）：bash build-db.sh
# 依赖：Python3 + Node.js；第2步首次需联网下载 ECDICT/Tofu/Kyle（有缓存则离线）
set -e
cd "$(dirname "$0")"
PY=python3; command -v python3 >/dev/null 2>&1 || PY=python

echo "== 1/3 基础词库(vocab.json，用 word.csv，不联网) =="
$PY tools/build_data.py

echo "== 2/3 全量词库(data/db.json，整合 ECDICT/Tofu/Kyle) =="
$PY tools/build_unified_db.py

echo "== 3/3 可接指数 + 过滤缩写/专名 =="
node tools/compute_chain_idx.js

echo ""
echo "✅ 词库重建完成：data/db.json"
echo "   重启服务生效：sudo systemctl restart word-chain"