#!/usr/bin/env bash
# deploy.sh — 一键部署 / 更新（在 VPS 上跑）
#
#   首次部署：  git clone https://github.com/laicz-007/word-chain-advanced.git ~/word-chain
#               cd ~/word-chain && bash deploy.sh
#   以后更新：  cd ~/word-chain && bash deploy.sh
#
# 它做四件事（可重复执行，不会出错）：
#   1) 更新代码（git pull）
#   2) 下载词库（词库不在 git 里，从最新 Release 取，约 16MB）
#   3) 词库体检（20 项硬指标 + 校验词库与代码是否同版）
#   4) 重启服务并自检（没配 systemd 就提示怎么手动跑）
#
# 只想看看"要不要更新"、不做任何改动：
#   bash deploy.sh --check
set -e
cd "$(dirname "$0")"

ASSET="https://github.com/laicz-007/word-chain-advanced/releases/latest/download"
SERVICE="word-chain"
CHECK_ONLY=0
if [ "$1" = "--check" ]; then CHECK_ONLY=1; fi

echo "=============================================="
echo " 单词接龙 · 部署/更新   目录: $(pwd)"
echo "=============================================="

# ---------- 0) 环境检查 ----------
if ! command -v node >/dev/null 2>&1; then
  echo "✗ 没找到 node。请先安装 Node.js 18+，例如："
  echo "    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -"
  echo "    sudo apt install -y nodejs"
  exit 1
fi
echo "  Node: $(node --version)"

# ---------- 1) 更新代码 ----------
echo ""
echo "==> 1/4 更新代码"
if [ -d .git ]; then
  git pull
else
  echo "    这不是 git 仓库，跳过。"
  echo "    （想以后能一条命令更新，用 git clone 重新部署一次）"
fi

# ---------- 2) 下载词库 ----------
if [ "$CHECK_ONLY" = "1" ]; then
  echo ""
  echo "==> 2/4 下载词库 —— 已跳过（--check 模式）"
else
  echo ""
  echo "==> 2/4 下载词库（约 16MB，来自最新 Release）"
  mkdir -p data && cd data
  # 词库不在 git 里（96MB 太大），必须单独取。db.build.json 是它的构建元数据。
  curl -fLO "$ASSET/db.json.gz"
  curl -fLO "$ASSET/db.build.json"
  gunzip -f db.json.gz
  cd ..
  echo "    data/db.json  $(du -h data/db.json | cut -f1)"
fi

# ---------- 3) 体检 ----------
echo ""
echo "==> 3/4 词库体检"
if [ -f data/db.json ]; then
  node tools/check_db.js
else
  echo "    ✗ 没有 data/db.json —— 词库没拿到，服务起不来。"
  echo "      手动取一次： cd data && curl -fLO $ASSET/db.json.gz && gunzip -f db.json.gz && cd .."
  exit 1
fi

if [ "$CHECK_ONLY" = "1" ]; then
  echo ""
  echo "（--check 模式，到此为止。要真正更新请跑： bash deploy.sh）"
  exit 0
fi

# ---------- 4) 重启 + 自检 ----------
echo ""
echo "==> 4/4 重启服务"
if command -v systemctl >/dev/null 2>&1 && systemctl list-unit-files 2>/dev/null | grep -q "^${SERVICE}.service"; then
  sudo systemctl restart "$SERVICE"
  sleep 2
  node healthcheck.js
else
  echo "    未检测到 systemd 服务 ${SERVICE}.service，没自动重启。"
  echo ""
  echo "    先手动跑一次确认没问题：   node server.js"
  echo "    想配成开机自启的常驻服务： 见 DEPLOY.md 第 4 节（约 30 秒）"
fi

echo ""
echo "=============================================="
echo " 完成。浏览器打开 http://<你的VPS地址>:8080"
echo "=============================================="
