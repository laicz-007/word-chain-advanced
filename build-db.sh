#!/usr/bin/env bash
# build-db.sh — 一键重建词库
# 用法（在项目根目录执行）：bash build-db.sh
#
# 三步链路的**唯一真相源是 package.json 的 build 脚本**，本文件只是它的 shell 入口，
# 这样两处不会各自漂移（历史上它们就分叉过：这里会跳过第 1 步、npm 那边不会）。
#   1) python tools/build_data.py         -> public/vocab.json
#   2) python tools/build_unified_db.py   -> data/db.raw.json （原始库）
#   3) node   tools/compute_chain_idx.js  -> data/db.json     （成品库）
set -e
cd "$(dirname "$0")"

if command -v npm >/dev/null 2>&1; then
  exec npm run build
fi

# ---- 没有 npm 时的退路：手动跑三步（Node 环境一般都有 npm，这条基本用不到）----
# ⚠️ 探测 Python 必须**实际执行一次**，不能只用 `command -v`：
#    Windows 上的 Microsoft Store 会放一个 python3.exe 占位别名，文件存在但一跑就报
#    "Python was not found"。只用 command -v 判断会选中这个坏的别名，导致三步全失败。
PY=""
for cand in python python3 py; do
  if command -v "$cand" >/dev/null 2>&1 && "$cand" --version >/dev/null 2>&1; then
    PY="$cand"; break
  fi
done
if [ -z "$PY" ]; then
  echo "❌ 找不到可用的 Python 3。请先安装 Python 3 并确保 python --version 能跑通。" >&2
  exit 1
fi
echo "使用 Python: $PY ($("$PY" --version 2>&1))"

echo "== 1/3 基础词池 public/vocab.json =="
"$PY" tools/build_data.py

echo "== 2/3 原始词库 data/db.raw.json =="
"$PY" tools/build_unified_db.py

echo "== 3/3 成品词库 data/db.json（过滤 + 可接指数）=="
node tools/compute_chain_idx.js

echo ""
echo "✅ 词库重建完成：data/db.json"
echo "   先体检一遍：node tools/check_db.js"
echo "   重启服务生效：sudo systemctl restart word-chain"
