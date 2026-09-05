#!/usr/bin/env bash
# update.sh — 一键更新：拉取最新代码 + 重启服务
# 前提：项目是用 git 部署的（git clone 来的）。首次迁移见 DEPLOY.md。
set -e
cd "$(dirname "$0")"

echo "== 1/2 拉取最新代码 =="
git pull origin main

echo "== 2/2 重启服务 =="
if command -v systemctl >/dev/null 2>&1 && systemctl is-enabled word-chain >/dev/null 2>&1; then
  sudo systemctl restart word-chain
  echo "✅ 已重启 systemd 服务：word-chain"
else
  echo "未检测到 systemd 服务 word-chain，请手动重启，例如："
  echo "  pkill -f 'node server.js'"
  echo "  cd $(pwd) && nohup node server.js > server.log 2>&1 &"
fi

echo "== 更新完成 =="
echo "注：data/（词库、账号、密钥）不入 git，不会被覆盖；若词库/数据有单独更新，需另传 data/ 下文件。"