#!/usr/bin/env bash
# migrate.sh — 一键迁移：把"手动上传部署"升级为"git 一键更新"
# 用法：在 VPS 上执行  bash migrate.sh
# 做什么：装 git → clone 到新目录 → 复制数据(data) → 校验 → 切换 systemd → 提示
# 安全：原目录 word-chain 全程不动，数据用"复制"不是"移动"，出问题可回滚。

set -e

OLD_DIR="/root/word-chain"        # 旧的手动部署目录
NEW_DIR="/root/word-chain-git"    # 新的 git 目录
REPO="https://github.com/laicz-007/word-chain-advanced.git"
SERVICE="word-chain"

echo "=== 单词接龙 · 一键迁移到 git 更新 ==="

# 1) 校验旧目录存在且含 data
if [ ! -d "$OLD_DIR" ] || [ ! -d "$OLD_DIR/data" ]; then
  echo "❌ 未找到 $OLD_DIR/data（旧的项目目录在别处？）"
  echo "   如果旧目录不是 /root/word-chain，请先编辑本脚本顶部的 OLD_DIR。"
  exit 1
fi
echo "✅ 找到旧项目目录：$OLD_DIR"

# 2) 装 git
if command -v git >/dev/null 2>&1; then
  echo "✅ git 已安装"
else
  echo "→ 安装 git ..."
  sudo apt-get install -y git
fi

# 3) 新目录已存在则提示（避免覆盖）
if [ -d "$NEW_DIR" ]; then
  echo "⚠️  $NEW_DIR 已存在（可能之前迁移过？）"
  echo "   若要重来，请先删除它：sudo rm -rf $NEW_DIR"
  exit 1
fi

# 4) clone
echo "→ 克隆仓库到 $NEW_DIR ..."
git clone "$REPO" "$NEW_DIR"

# 5) 复制数据（命根子：用 cp 不用 mv）
echo "→ 复制数据目录 data/ ..."
cp -r "$OLD_DIR/data" "$NEW_DIR/data"

# 6) 校验关键文件
echo "→ 校验数据 ..."
if [ -f "$NEW_DIR/data/db.json" ]; then
  SIZE=$(du -h "$NEW_DIR/data/db.json" | cut -f1)
  echo "✅ 词库 db.json 在（$SIZE）"
else
  echo "❌ db.json 不在！数据复制失败，请检查。"
  exit 1
fi
for f in users.json .secret usage.json; do
  if [ -f "$NEW_DIR/data/$f" ]; then echo "✅ $f 在"; else echo "⚠️  $f 不存在（可能是全新部署，无妨）"; fi
done
[ -d "$NEW_DIR/data/sync" ] && echo "✅ sync/ 在（玩家画像/记录）" || echo "⚠️  sync/ 不存在（无历史画像，无妨）"

# 7) 切换 systemd（若存在服务）
if command -v systemctl >/dev/null 2>&1 && systemctl is-enabled "$SERVICE" >/dev/null 2>&1; then
  echo "→ 切换 systemd 服务 $SERVICE 到新目录 ..."
  sudo systemctl stop "$SERVICE" || true
  sudo sed -i "s|$OLD_DIR|$NEW_DIR|g" "/etc/systemd/system/$SERVICE.service"
  sudo systemctl daemon-reload
  sudo systemctl start "$SERVICE"
  echo "✅ systemd 已切换并启动。"
else
  echo "→ 未检测到 systemd 服务（可能是 nohup 手动跑的）。"
  echo "  请手动重启新目录："
  echo "    pkill -f 'node server.js'"
  echo "    cd $NEW_DIR && nohup node server.js > server.log 2>&1 &"
fi

echo ""
echo "========================================"
echo "🎉 迁移完成！"
echo "   新项目目录：$NEW_DIR"
echo "   浏览器打开 http://<你的IP>:8080 用老账号登录，确认数据还在。"
echo ""
echo "以后每次更新，只需执行："
echo "    cd $NEW_DIR && bash update.sh"
echo ""
echo "⚠️  旧的 $OLD_DIR 先留着别删（备份/回滚），确认稳定 3 天后可删："
echo "    sudo rm -rf $OLD_DIR"
echo "========================================"