#!/usr/bin/env bash
# build-db.sh — 一键生成词库（整合数据源 + 算 chain_idx + 过滤缩写）
# 用法（在项目根目录执行）：bash build-db.sh
# 依赖：Python3 + Node.js + 能访问 GitHub（首次下载 ECDICT/Tofu/Kyle）
set -e
cd "$(dirname "$0")"

echo "== 1/2 整合词库（下载 ECDICT/Tofu/Kyle，生成 data/db.json）=="
python3 tools/build_unified_db.py || python tools/build_unified_db.py

echo "== 2/2 计算可接指数 + 过滤缩写/专名 =="
node tools/compute_chain_idx.js

echo ""
echo "✅ 词库生成完成：data/db.json"
echo "   接下来重启服务使新词库生效："
echo "   sudo systemctl restart word-chain   （或手动重启 node server.js）"